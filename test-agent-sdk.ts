import assert from "node:assert/strict";
import OpenAI from "openai";
import { Agent, OpenAIResponsesModel, run, setTracingDisabled } from "@openai/agents";
import { listModels, visibleModels } from "./src/models.ts";

// Run with: npm run test:agent (loads the token and model saved in .env).
const token = process.env.OPENAI_ACCESS_TOKEN;

assert.ok(token, "Missing OPENAI_ACCESS_TOKEN. Run npm start and press s to save credentials.");

// ChatGPT OAuth credentials are used for inference; do not export API traces.
setTracingDisabled(true);

try {
  const model = process.env.OPENAI_MODEL || visibleModels(await listModels(token))[0]?.slug;
  assert.ok(model, "No available models. Set OPENAI_MODEL to a model from your account's catalog.");
  const client = new OpenAI({ apiKey: token, timeout: 30_000, maxRetries: 0 });
  const agent = new Agent({
    name: "Token smoke test",
    instructions: "Reply with exactly OK, without punctuation or any other text.",
    model: new OpenAIResponsesModel(client, model),
    modelSettings: { store: false },
  });
  console.log(`Testing Agents SDK with ${model}...`);
  const result = await run(agent, "Confirm that you received this message.", {
    stream: true,
    maxTurns: 1,
  });
  await result.completed;
  assert.equal(result.finalOutput?.trim(), "OK");
  console.log(`PASS: ${result.finalOutput}`);
} catch (error) {
  console.error("FAIL:", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
}
