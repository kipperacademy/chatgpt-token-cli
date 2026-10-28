import http from "node:http";
import {
  AGENT_NAME_HINT,
  AUTH_ENDPOINT,
  CALLBACK_TIMEOUT_MS,
  HOST,
  PORT,
  REDIRECT_URI,
  REGISTRATION_CLIENT_ID,
  RESOURCE,
  SCOPES,
  TOKEN_ENDPOINT,
} from "./config.ts";

export interface AuthorizationCallback {
  code: string;
  clientId: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  [key: string]: unknown;
}

export class AuthError extends Error {
  readonly details?: string;
  constructor(message: string, details?: string) {
    super(message);
    this.name = "AuthError";
    this.details = details;
  }
}

export function buildAuthorizationUrl(opts: {
  challenge: string;
  state: string;
  hostId: string;
}): string {
  const url = new URL(AUTH_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: REGISTRATION_CLIENT_ID,
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: opts.challenge,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    resource: RESOURCE,
    ext_agent_host_id: opts.hostId,
    agent_name_hint: AGENT_NAME_HINT,
    state: opts.state,
  }).toString();
  return url.toString();
}

const SUCCESS_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Authentication successful</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0f172a;color:#e2e8f0}
main{text-align:center;max-width:32rem;padding:2rem}h1{font-size:1.5rem}p{color:#94a3b8}</style></head>
<body><main><h1>Authentication successful!</h1>
<p>You can now close this tab and return to your terminal.</p></main></body></html>`;

function errorHtml(message: string): string {
  const safe = message.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Authentication failed</title></head>
<body style="font-family:system-ui,sans-serif;padding:2rem"><h1>Authentication failed</h1><p>${safe}</p></body></html>`;
}

/**
 * Starts the loopback server and resolves with the authorization code once the
 * browser redirects back. `onListening` fires as soon as the port is bound so
 * the caller can open the browser.
 */
export function waitForCallback(
  expectedState: string,
  onListening: () => void,
): Promise<AuthorizationCallback> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Stop accepting connections; sockets whose response is still flushing
      // close themselves because every response carries "Connection: close".
      server.close();
      server.closeIdleConnections();
      fn();
    };

    const send = (res: http.ServerResponse, status: number, type: string, body: string) => {
      res.writeHead(status, { "Content-Type": type, "Content-Length": Buffer.byteLength(body), Connection: "close" });
      res.end(body);
    };

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
      if (url.pathname !== "/callback") {
        send(res, 404, "text/plain", "Not found");
        return;
      }

      const params = url.searchParams;
      const oauthError = params.get("error");
      if (oauthError) {
        const description = params.get("error_description") ?? "";
        send(res, 400, "text/html", errorHtml(`${oauthError}: ${description}`));
        finish(() => reject(new AuthError(`Authorization denied: ${oauthError}`, description)));
        return;
      }

      if (params.get("state") !== expectedState) {
        send(res, 400, "text/html", errorHtml("State mismatch. Security check failed."));
        finish(() => reject(new AuthError("State mismatch: possible CSRF, aborting.")));
        return;
      }

      const code = params.get("code");
      if (!code) {
        send(res, 400, "text/html", errorHtml("Missing authorization code."));
        finish(() => reject(new AuthError("Callback did not include an authorization code.")));
        return;
      }

      const clientId = params.get("client_id") ?? REGISTRATION_CLIENT_ID;
      send(res, 200, "text/html", SUCCESS_HTML);
      finish(() => resolve({ code, clientId }));
    });

    const timer = setTimeout(() => {
      server.closeAllConnections();
      finish(() => reject(new AuthError(`Timed out after ${CALLBACK_TIMEOUT_MS / 1000}s waiting for the browser callback.`)));
    }, CALLBACK_TIMEOUT_MS);

    server.on("error", (err: NodeJS.ErrnoException) => {
      const hint = err.code === "EADDRINUSE" ? ` Port ${PORT} is already in use; close the other process and retry.` : "";
      finish(() => reject(new AuthError(`Could not start callback server: ${err.message}.${hint}`)));
    });

    server.listen(PORT, HOST, onListening);
  });
}

export async function exchangeCodeForToken(opts: {
  code: string;
  clientId: string;
  verifier: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: opts.clientId,
    code: opts.code,
    redirect_uri: REDIRECT_URI,
    code_verifier: opts.verifier,
    resource: RESOURCE,
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });

  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new AuthError(`Token endpoint returned non-JSON (${res.status})`, text.slice(0, 500));
  }

  if (!res.ok || typeof data !== "object" || data === null || !("access_token" in data)) {
    const err = data as { error?: string; error_description?: string };
    throw new AuthError(
      `Token exchange failed (${res.status}): ${err.error ?? "unknown_error"}`,
      err.error_description ?? text.slice(0, 500),
    );
  }
  return data as TokenResponse;
}
