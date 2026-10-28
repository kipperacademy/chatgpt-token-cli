import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { buildAuthorizationUrl, exchangeCodeForToken, waitForCallback, AuthError } from "../src/auth.ts";
import { generatePkce, generateState, loadOrCreateHostId } from "../src/pkce.ts";
import { REDIRECT_URI } from "../src/config.ts";

test("PKCE challenge is base64url(sha256(verifier))", () => {
  const { verifier, challenge } = generatePkce();
  assert.ok(verifier.length >= 43 && verifier.length <= 128);
  assert.match(verifier, /^[A-Za-z0-9\-_]+$/);
  assert.equal(challenge, crypto.createHash("sha256").update(verifier).digest("base64url"));
});

test("host id is a persisted urn:uuid", () => {
  const a = loadOrCreateHostId();
  assert.match(a, /^urn:uuid:[0-9a-f-]{36}$/);
  assert.equal(loadOrCreateHostId(), a);
});

test("authorization URL carries every required parameter", () => {
  const url = new URL(buildAuthorizationUrl({ challenge: "C", state: "S", hostId: "urn:uuid:x" }));
  assert.equal(url.origin + url.pathname, "https://auth.openai.com/api/accounts/authorize");
  const p = url.searchParams;
  assert.equal(p.get("client_id"), "dynamic_agent_client");
  assert.equal(p.get("response_type"), "code");
  assert.equal(p.get("code_challenge_method"), "S256");
  assert.equal(p.get("code_challenge"), "C");
  assert.equal(p.get("redirect_uri"), REDIRECT_URI);
  assert.equal(p.get("scope"), "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct");
  assert.equal(p.get("resource"), "https://api.openai.com/v1");
  assert.equal(p.get("ext_agent_host_id"), "urn:uuid:x");
  assert.equal(p.get("agent_name_hint"), "KipperDev");
  assert.equal(p.get("state"), "S");
});

test("callback server rejects state mismatch", async () => {
  const state = generateState();
  const done = waitForCallback(state, () => {});
  const rejected = assert.rejects(done, (e: unknown) => e instanceof AuthError && /State mismatch/.test(e.message));
  const bad = await fetch(`${REDIRECT_URI}?state=wrong&code=abc`);
  assert.equal(bad.status, 400);
  await rejected;
});

test("callback server surfaces OAuth errors", async () => {
  const state = generateState();
  const done = waitForCallback(state, () => {});
  const rejected = assert.rejects(done, (e: unknown) => e instanceof AuthError && e.details === "User said no");
  const res = await fetch(`${REDIRECT_URI}?state=${state}&error=access_denied&error_description=User+said+no`);
  assert.equal(res.status, 400);
  await rejected;
});

test("callback server resolves with code and issued client_id, serves success page, then closes", async () => {
  const state = generateState();
  let listening = false;
  const done = waitForCallback(state, () => { listening = true; });
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(listening);
  const res = await fetch(`${REDIRECT_URI}?state=${state}&code=the-code&client_id=issued-123`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Authentication successful/);
  assert.deepEqual(await done, { code: "the-code", clientId: "issued-123" });
  await assert.rejects(fetch(REDIRECT_URI), /fetch failed/);
});

test("token exchange posts the right form body and parses the response", async () => {
  const realFetch = globalThis.fetch;
  let captured: { url: string; init: RequestInit } | undefined;
  globalThis.fetch = (async (url: any, init: any) => {
    captured = { url: String(url), init };
    return new Response(JSON.stringify({ access_token: "tok", refresh_token: "ref", expires_in: 3600, scope: "openid chatgpt.tokens.use.direct" }), { status: 200 });
  }) as typeof fetch;
  try {
    const t = await exchangeCodeForToken({ code: "the-code", clientId: "issued-123", verifier: "verif" });
    assert.equal(t.access_token, "tok");
    assert.equal(captured!.url, "https://auth.openai.com/api/accounts/oauth/token");
    assert.equal(captured!.init.method, "POST");
    assert.equal((captured!.init.headers as any)["Content-Type"], "application/x-www-form-urlencoded");
    const body = new URLSearchParams(String(captured!.init.body));
    assert.deepEqual(Object.fromEntries(body), {
      grant_type: "authorization_code", client_id: "issued-123", code: "the-code",
      redirect_uri: REDIRECT_URI, code_verifier: "verif", resource: "https://api.openai.com/v1",
    });
  } finally { globalThis.fetch = realFetch; }
});

test("token exchange reports server-side errors", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: "invalid_grant", error_description: "bad code" }), { status: 400 })) as typeof fetch;
  try {
    await assert.rejects(
      exchangeCodeForToken({ code: "x", clientId: "y", verifier: "z" }),
      (e: unknown) => e instanceof AuthError && /invalid_grant/.test(e.message) && e.details === "bad code",
    );
  } finally { globalThis.fetch = realFetch; }
});
