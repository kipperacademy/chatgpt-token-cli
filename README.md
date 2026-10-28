# KipperDev · chatgpt-token-cli

Terminal tool that signs you in with ChatGPT using the dynamic-client OAuth 2.0
Authorization Code + PKCE (S256) flow and prints the resulting Bearer
`access_token`.

Press Enter, approve in the browser, get the token. No runtime dependencies:
only Node's built-in `http`, `crypto`, `readline`, `child_process` and `fetch`.

## Requirements

- Node.js 22.6 or newer (TypeScript runs natively; Node 23+/26 needs no flags).

## Usage

```bash
npm install          # dev deps only (typescript, @types/node)
npm start            # or: node src/index.ts
npm start -- --full  # print the full token instead of a truncated preview
```

Flow:

1. Press `ENTER` at the welcome screen.
2. A loopback server starts on `http://127.0.0.1:1455/callback` and the
   system browser opens the OpenAI authorization page. If the browser does
   not open, the URL is printed so you can paste it.
3. After you approve, the browser shows a confirmation page and the terminal
   exchanges the code for tokens.
4. The terminal shows granted scopes, expiry and the access token, then
   fetches `GET /v1/models` with the token and lists the models this
   account can actually use (slug, name, context window, reasoning levels).
5. Actions:
   - `c` copy the access token to the clipboard
   - `s` save credentials to `~/.chatgpt-cli/credentials.json` (including
     the model slugs) and write `OPENAI_ACCESS_TOKEN`,
     `OPENAI_REFRESH_TOKEN` and `OPENAI_MODEL` to `./.env`
   - `m` re-list models, toggling hidden ones (`visibility != "list"`)
   - `t` test a model: sends the minimal streaming request below and prints
     the reply
   - `q` exit

## Using the token

This is a **ChatGPT plan token, not an API key**. It is accepted by
`https://api.openai.com/v1` but only under the Sign in with ChatGPT rules:

- Only models returned by `GET /v1/models` for this account work. Public
  model names such as `gpt-4o` or `gpt-5` return
  `400 model_not_found: "The '<model>' model is not supported when using Codex
  with a ChatGPT account."` The catalog changes over time, so always read it
  from the endpoint instead of hardcoding slugs.
- `POST /v1/responses` must send `input` as a list of messages, `store: false`
  and `stream: true`. Omit `temperature`, `top_p`, `max_output_tokens`,
  `metadata`, `user`, `previous_response_id` and system-role messages; put
  system guidance in `instructions`.
- Treat the request as successful only after a `response.completed` event.

Minimal working call:

```bash
curl -s -N https://api.openai.com/v1/responses \
  -H "Authorization: Bearer $OPENAI_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-6-luna",
    "store": false,
    "stream": true,
    "input": [{"role":"user","content":[{"type":"input_text","text":"Reply with the single word OK."}]}]
  }'
```

## Files on disk

| Path | Purpose |
| --- | --- |
| `~/.chatgpt-cli/host_id` | Persistent `urn:uuid:<v4>` sent as `ext_agent_host_id` |
| `~/.chatgpt-cli/credentials.json` | Written only when you press `s` (mode 0600) |
| `./.env` | Written only when you press `s` (mode 0600) |

## Endpoints and parameters

| Item | Value |
| --- | --- |
| Authorize | `https://auth.openai.com/api/accounts/authorize` |
| Token | `https://auth.openai.com/api/accounts/oauth/token` |
| Registration client ID | `dynamic_agent_client` |
| Redirect URI | `http://127.0.0.1:1455/callback` |
| Resource | `https://api.openai.com/v1` |
| Scopes | `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct` |
| Agent name hint | `KipperDev` |

The callback handler validates `state`, surfaces `error` /
`error_description`, and uses the `client_id` OpenAI returns in the redirect
for the token exchange (falling back to `dynamic_agent_client`). The callback
waits at most 5 minutes before giving up.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # node --test (PKCE, URL builder, callback server, token exchange)
npm run test:agent  # live Agents SDK smoke test using OPENAI_ACCESS_TOKEN and OPENAI_MODEL from .env
```

The Agents SDK smoke test requires credentials saved with `s` in the CLI.
It makes one streamed agent call with `store: false`, disables tracing, and
checks that the final answer is `OK`. It uses your account's model allowance
and is separate from the local test suite. If `OPENAI_MODEL` is unset, it
selects the first visible model from your account's catalog. SDK dependencies
are dev-only.

Testing hooks (never needed in normal use):

- `CHATGPT_CLI_NO_BROWSER=1` skips launching a browser.
- `CHATGPT_TOKEN_ENDPOINT_OVERRIDE=<url>` points the token exchange at a mock.
- `CHATGPT_API_BASE_OVERRIDE=<url>` points `/models` and `/responses` at a mock.

## Layout

```
src/
  index.ts   entry point: screens, action menu, error handling
  auth.ts    authorization URL, loopback callback server, token exchange
  models.ts  GET /v1/models catalog and minimal streaming test request
  pkce.ts    PKCE verifier/challenge, state, persistent host id
  system.ts  open browser, copy to clipboard (macOS / Linux / Windows)
  ui.ts      banner, colors, spinner, key input
  config.ts  endpoints, port, scopes
test/
  auth.test.ts
  models.test.ts
```
