#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { AuthError, buildAuthorizationUrl, exchangeCodeForToken, waitForCallback, type TokenResponse } from "./auth.ts";
import { REDIRECT_URI } from "./config.ts";
import { CONFIG_DIR, generatePkce, generateState, loadOrCreateHostId } from "./pkce.ts";
import { listModels, reasoningLevels, testModel, visibleModels, type ModelInfo } from "./models.ts";
import { copyToClipboard, openBrowser } from "./system.ts";
import { BANNER, Spinner, bold, cyan, dim, green, readKey, readLine, red, truncateToken, waitForEnter, yellow } from "./ui.ts";

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
  console.log("\n" + dim("--------------------- ACCESS TOKEN (ChatGPT plan token) ---------------------"));
  console.log(showFull ? token.access_token : truncateToken(token.access_token));
  console.log(dim(rule));
  if (!showFull) console.log(dim("Run with --full to print the whole token, or use [c] to copy it."));
  console.log(dim("\nThis is a ChatGPT plan token, not an API key: it only works with the models listed"));
  console.log(dim("below and requires input as a list, store:false and stream:true on POST /v1/responses."));
}

function printModels(models: ModelInfo[], includeHidden: boolean): void {
  const shown = includeHidden ? models : visibleModels(models);
  const hiddenCount = models.length - visibleModels(models).length;
  console.log("\n" + bold(`Models available to this account (${shown.length})`) + (includeHidden || hiddenCount === 0 ? "" : dim(`  +${hiddenCount} hidden, press [m] to show`)));
  if (shown.length === 0) {
    console.log(yellow("  none reported"));
    return;
  }
  const slugWidth = Math.max(...shown.map((m) => m.slug.length));
  for (const m of shown) {
    const ctx = m.context_window ? `${Math.round(m.context_window / 1000)}k ctx` : "";
    const hidden = m.visibility && m.visibility !== "list" ? yellow(` [${m.visibility}]`) : "";
    const levels = reasoningLevels(m);
    console.log(`  ${cyan(m.slug.padEnd(slugWidth))}  ${(m.display_name ?? "").padEnd(16)} ${dim(ctx.padEnd(9))}${hidden}`);
    if (m.description) console.log(`  ${" ".repeat(slugWidth)}  ${dim(String(m.description))}`);
    if (levels.length) console.log(`  ${" ".repeat(slugWidth)}  ${dim("reasoning: " + levels.join(", "))}`);
  }
}

async function fetchModelsSafely(token: TokenResponse): Promise<ModelInfo[]> {
  const spinner = new Spinner("Fetching models available to this account...").start();
  try {
    const models = await listModels(token.access_token);
    spinner.stop();
    return models;
  } catch (err) {
    spinner.stop(yellow("[!] Could not fetch the model list: ") + (err instanceof Error ? err.message : String(err)));
    return [];
  }
}

async function runModelTest(token: TokenResponse, models: ModelInfo[]): Promise<void> {
  const visible = visibleModels(models);
  const fallback = visible[0]?.slug ?? models[0]?.slug ?? "gpt-6.1-sol";
  const answer = (await readLine(`Model slug to test ${dim(`[${fallback}]`)}: `)).trim();
  const slug = answer || fallback;
  const spinner = new Spinner(`POST /v1/responses with ${slug} (store:false, stream:true)...`).start();
  const result = await testModel(token.access_token, slug);
  spinner.stop();
  if (result.ok) {
    console.log(green(`✔ ${slug} works.`) + ` Model replied: ${bold(result.outputText || "(empty)")}`);
  } else {
    console.log(red(`✘ ${slug} failed (HTTP ${result.status}): `) + result.outcome);
  }
}

function saveCredentials(token: TokenResponse, models: ModelInfo[]): string[] {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const written: string[] = [];

  const jsonPath = path.join(CONFIG_DIR, "credentials.json");
  const payload = { ...token, obtained_at: new Date().toISOString(), models: visibleModels(models).map((m) => m.slug) };
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2) + "\n", { mode: 0o600 });
  written.push(jsonPath);

  const envPath = path.join(process.cwd(), ".env");
  const lines = [`OPENAI_ACCESS_TOKEN=${token.access_token}`];
  if (token.refresh_token) lines.push(`OPENAI_REFRESH_TOKEN=${token.refresh_token}`);
  const defaultModel = visibleModels(models)[0]?.slug;
  if (defaultModel) lines.push(`OPENAI_MODEL=${defaultModel}`);
  let existing = "";
  try { existing = fs.readFileSync(envPath, "utf8"); } catch { /* new file */ }
  const filtered = existing
    .split("\n")
    .filter((l) => !/^OPENAI_(ACCESS_TOKEN|REFRESH_TOKEN|MODEL)=/.test(l))
    .join("\n")
    .replace(/\n*$/, existing ? "\n" : "");
  fs.writeFileSync(envPath, filtered + lines.join("\n") + "\n", { mode: 0o600 });
  written.push(envPath);
  return written;
}

async function actionMenu(token: TokenResponse, models: ModelInfo[]): Promise<void> {
  let showHidden = false;
  for (;;) {
    console.log(`\n${cyan("[c]")} Copy token   ${cyan("[s]")} Save credentials   ${cyan("[m]")} List models   ${cyan("[t]")} Test a model   ${cyan("[q]")} Exit`);
    process.stdout.write(dim("> "));
    const key = await readKey();
    console.log(key || "");
    if (key === "c") {
      const ok = await copyToClipboard(token.access_token);
      console.log(ok ? green("✔ Access token copied to clipboard.") : red("✘ No clipboard tool found (pbcopy / wl-copy / xclip / xsel / clip)."));
    } else if (key === "s") {
      for (const file of saveCredentials(token, models)) console.log(green("✔ Saved ") + file);
    } else if (key === "m") {
      if (models.length === 0) models.push(...(await fetchModelsSafely(token)));
      showHidden = !showHidden || models.length === visibleModels(models).length;
      printModels(models, showHidden);
    } else if (key === "t") {
      await runModelTest(token, models);
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
  const models = await fetchModelsSafely(token);
  printModels(models, false);
  await actionMenu(token, models);
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
