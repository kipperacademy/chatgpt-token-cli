#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { AuthError, buildAuthorizationUrl, exchangeCodeForToken, waitForCallback, type TokenResponse } from "./auth.ts";
import { REDIRECT_URI } from "./config.ts";
import { CONFIG_DIR, generatePkce, generateState, loadOrCreateHostId } from "./pkce.ts";
import { copyToClipboard, openBrowser } from "./system.ts";
import { BANNER, Spinner, bold, cyan, dim, green, readKey, red, truncateToken, waitForEnter, yellow } from "./ui.ts";

const showFull = process.argv.includes("--full");

async function authenticate(): Promise<TokenResponse> {
  const hostId = loadOrCreateHostId();
  const { verifier, challenge } = generatePkce();
  const state = generateState();
  const authUrl = buildAuthorizationUrl({ challenge, state, hostId });

  let spinner: Spinner | undefined;
  const callback = await waitForCallback(state, () => {
    console.log(green("[+]") + ` Local callback server listening on ${REDIRECT_URI}`);
    void openBrowser(authUrl).then((opened) => {
      if (opened) {
        console.log(green("[+]") + " Opened browser. Please complete the authorization in your browser...");
        console.log(dim("    If the browser did not open, visit:\n    " + authUrl + "\n"));
      } else {
        console.log(yellow("[!]") + " Could not open a browser automatically. Open this URL manually:");
        console.log("    " + authUrl + "\n");
      }
      spinner = new Spinner("Waiting for authorization callback...").start();
    });
  });

  spinner?.stop(green("[+]") + " Authorization code received. Exchanging for token...");
  const exchanging = new Spinner("Contacting token endpoint...").start();
  try {
    const token = await exchangeCodeForToken({ code: callback.code, clientId: callback.clientId, verifier });
    exchanging.stop();
    return token;
  } catch (err) {
    exchanging.stop();
    throw err;
  }
}

function printSuccess(token: TokenResponse): void {
  const scopes = (token.scope ?? "").split(/\s+/).filter(Boolean).join(", ") || dim("(not reported)");
  const expires = token.expires_in != null ? `${token.expires_in} seconds` : dim("(not reported)");
  const rule = "-".repeat(74);

  console.log("\n" + green("✔ Authentication successful!") + "\n");
  console.log(`${bold("Granted Scopes:")} ${scopes}`);
  console.log(`${bold("Expires In:    ")} ${expires}`);
  if (token.refresh_token) console.log(`${bold("Refresh Token: ")} ${dim("present (saved with [s])")}`);
  console.log("\n" + dim("------------------------- ACCESS TOKEN (API KEY) -------------------------"));
  console.log(showFull ? token.access_token : truncateToken(token.access_token));
  console.log(dim(rule));
  if (!showFull) console.log(dim("Run with --full to print the whole token, or use [c] to copy it."));
}

function saveCredentials(token: TokenResponse): string[] {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const written: string[] = [];

  const jsonPath = path.join(CONFIG_DIR, "credentials.json");
  const payload = { ...token, obtained_at: new Date().toISOString() };
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2) + "\n", { mode: 0o600 });
  written.push(jsonPath);

  const envPath = path.join(process.cwd(), ".env");
  const lines = [`OPENAI_ACCESS_TOKEN=${token.access_token}`];
  if (token.refresh_token) lines.push(`OPENAI_REFRESH_TOKEN=${token.refresh_token}`);
  let existing = "";
  try { existing = fs.readFileSync(envPath, "utf8"); } catch { /* new file */ }
  const filtered = existing
    .split("\n")
    .filter((l) => !/^OPENAI_(ACCESS|REFRESH)_TOKEN=/.test(l))
    .join("\n")
    .replace(/\n*$/, existing ? "\n" : "");
  fs.writeFileSync(envPath, filtered + lines.join("\n") + "\n", { mode: 0o600 });
  written.push(envPath);
  return written;
}

async function actionMenu(token: TokenResponse): Promise<void> {
  for (;;) {
    console.log(`\n${cyan("[c]")} Copy token to clipboard   ${cyan("[s]")} Save credentials to .env / config file   ${cyan("[q]")} Exit`);
    process.stdout.write(dim("> "));
    const key = await readKey();
    console.log(key || "");
    if (key === "c") {
      const ok = await copyToClipboard(token.access_token);
      console.log(ok ? green("✔ Access token copied to clipboard.") : red("✘ No clipboard tool found (pbcopy / wl-copy / xclip / xsel / clip)."));
    } else if (key === "s") {
      for (const file of saveCredentials(token)) console.log(green("✔ Saved ") + file);
    } else if (key === "q" || key === "\r" || key === "\n" || key === "\x1b") {
      return;
    } else {
      console.log(yellow(`Unknown option "${key}".`));
    }
  }
}

async function main(): Promise<void> {
  console.log(cyan(BANNER));
  console.log(bold("KipperDev") + dim("  ·  Sign in with ChatGPT") + dim("  ·  OAuth 2.0 Authorization Code + PKCE (S256)"));
  console.log(dim("Authenticates against auth.openai.com and prints your Bearer access token.\n"));

  await waitForEnter(bold("Press [ENTER] to sign in with ChatGPT and fetch your token... "));
  console.log();

  const token = await authenticate();
  printSuccess(token);
  await actionMenu(token);
  console.log(dim("Bye."));
}

main().catch((err: unknown) => {
  if (err instanceof AuthError) {
    console.error("\n" + red("✘ " + err.message));
    if (err.details) console.error(dim("  " + err.details));
  } else {
    console.error("\n" + red("✘ Unexpected error:"), err);
  }
  process.exit(1);
});
