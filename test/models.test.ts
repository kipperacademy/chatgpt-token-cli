import { test } from "node:test";
import assert from "node:assert/strict";
import { listModels, reasoningLevels, testModel, visibleModels } from "../src/models.ts";

const CATALOG = {
  models: [
    { slug: "gpt-6.1-sol", display_name: "GPT-6.1-Sol", context_window: 500000, visibility: "list", description: "Latest workhorse", supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }] },
    { slug: "gpt-6-luna", display_name: "GPT-6-Luna", context_window: 272000, visibility: "list" },
    { slug: "gpt-reserve", display_name: "GPT-Reserve", context_window: 272000, visibility: "hide" },
  ],
};

function withFetch<T>(impl: (url: string, init?: RequestInit) => Promise<Response>, fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = ((u: any, i: any) => impl(String(u), i)) as typeof fetch;
  return fn().finally(() => { globalThis.fetch = real; });
}

test("listModels sends the bearer token and parses the catalog", async () => {
  let seen: { url: string; auth: string } | undefined;
  const models = await withFetch(async (url, init) => {
    seen = { url, auth: (init!.headers as any).Authorization };
    return new Response(JSON.stringify(CATALOG), { status: 200 });
  }, () => listModels("tok"));
  assert.equal(seen!.url, "https://api.openai.com/v1/models");
  assert.equal(seen!.auth, "Bearer tok");
  assert.deepEqual(models.map((m) => m.slug), ["gpt-6.1-sol", "gpt-6-luna", "gpt-reserve"]);
  assert.deepEqual(visibleModels(models).map((m) => m.slug), ["gpt-6.1-sol", "gpt-6-luna"]);
  assert.deepEqual(reasoningLevels(models[0]!), ["low", "high"]);
});

test("listModels surfaces HTTP errors", async () => {
  await assert.rejects(
    withFetch(async () => new Response("{\"detail\":\"nope\"}", { status: 401 }), () => listModels("bad")),
    /Could not list models \(401\)/,
  );
});

test("testModel sends the ChatGPT-plan request shape and reads the SSE stream", async () => {
  let body: any;
  const sse = [
    'event: response.created\ndata: {"type":"response.created"}\n\n',
    'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"O"}\n\n',
    'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"K"}\n\n',
    'event: response.completed\ndata: {"type":"response.completed"}\n\n',
  ];
  const result = await withFetch(async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    body = JSON.parse(String(init!.body));
    const stream = new ReadableStream({
      start(c) { for (const s of sse) c.enqueue(new TextEncoder().encode(s)); c.close(); },
    });
    return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }, () => testModel("tok", "gpt-6-luna"));
  assert.equal(body.model, "gpt-6-luna");
  assert.equal(body.store, false);
  assert.equal(body.stream, true);
  assert.ok(Array.isArray(body.input));
  assert.equal(body.input[0].role, "user");
  assert.equal(body.input[0].content[0].type, "input_text");
  for (const k of ["temperature", "top_p", "max_output_tokens", "metadata", "user"]) assert.ok(!(k in body), k);
  assert.deepEqual(result, { ok: true, status: 200, outputText: "OK", outcome: "response.completed" });
});

test("testModel reports the model_not_found message on 400", async () => {
  const result = await withFetch(
    async () => new Response(JSON.stringify({ detail: "x", error: { code: "model_not_found", message: "The 'gpt-4o' model is not supported when using Codex with a ChatGPT account." } }), { status: 400 }),
    () => testModel("tok", "gpt-4o"),
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.match(result.outcome, /not supported when using Codex/);
});
