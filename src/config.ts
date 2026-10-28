export const PORT = 1455;
export const HOST = "127.0.0.1";
export const REDIRECT_URI = `http://${HOST}:${PORT}/callback`;

export const AUTH_ENDPOINT = "https://auth.openai.com/api/accounts/authorize";
/** Overridable only for local testing against a mock server. */
export const TOKEN_ENDPOINT =
  process.env.CHATGPT_TOKEN_ENDPOINT_OVERRIDE ?? "https://auth.openai.com/api/accounts/oauth/token";
export const REGISTRATION_CLIENT_ID = "dynamic_agent_client";
export const RESOURCE = "https://api.openai.com/v1";
export const SCOPES =
  "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
export const AGENT_NAME_HINT = "KipperDev";

/** How long to wait for the browser callback before giving up. */
export const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;
