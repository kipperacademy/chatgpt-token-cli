import { RESOURCE } from "./config.ts";
import { AuthError } from "./auth.ts";

/** Entry returned by GET /v1/models when called with a ChatGPT-plan access token. */
export interface ModelInfo {
  slug: string;
  display_name?: string;
  description?: string;
  context_window?: number;
  visibility?: string;
  supported_reasoning_levels?: Array<string | { effort?: string }>;
  [key: string]: unknown;
}

/** Overridable only for local testing against a mock server. */
const API_BASE = process.env.CHATGPT_API_BASE_OVERRIDE ?? RESOURCE;

export async function listModels(accessToken: string): Promise<ModelInfo[]> {
  const res = await fetch(`${API_BASE}/models`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) throw new AuthError(`Could not list models (${res.status})`, text.slice(0, 500));
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new AuthError("Models endpoint returned non-JSON", text.slice(0, 500));
  }
  const list = (data as { models?: unknown; data?: unknown }).models ?? (data as { data?: unknown }).data;
  if (!Array.isArray(list)) throw new AuthError("Models endpoint returned an unexpected shape", text.slice(0, 500));
  return list
    .map((m) => (m && typeof m === "object" ? (m as Record<string, unknown>) : {}))
    .map((m) => ({ ...m, slug: String(m.slug ?? m.id ?? "") }) as ModelInfo)
    .filter((m) => m.slug.length > 0);
}

export function visibleModels(models: ModelInfo[]): ModelInfo[] {
  return models.filter((m) => m.visibility === undefined || m.visibility === "list");
}

export function reasoningLevels(m: ModelInfo): string[] {
  return (m.supported_reasoning_levels ?? [])
    .map((l) => (typeof l === "string" ? l : l.effort ?? ""))
    .filter(Boolean);
}

export interface TestResult {
  ok: boolean;
  status: number;
  outputText: string;
  /** Final event type seen (response.completed, response.failed, ...) or error text. */
  outcome: string;
}

/**
 * Minimal request that ChatGPT-plan tokens accept: input as a list, store:false,
 * stream:true, and no optional sampling fields. Returns the concatenated output text.
 */
export async function testModel(accessToken: string, slug: string, prompt = "Reply with the single word OK."): Promise<TestResult> {
  const res = await fetch(`${API_BASE}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: slug,
      store: false,
      stream: true,
      input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
    }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text();
    let outcome = text.slice(0, 300);
    try {
      const j = JSON.parse(text) as { detail?: string; error?: { message?: string } };
      outcome = j.error?.message ?? j.detail ?? outcome;
    } catch { /* keep raw text */ }
    return { ok: false, status: res.status, outputText: "", outcome };
  }

  let outputText = "";
  let outcome = "stream ended without response.completed";
  let buffer = "";
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      let ev: { type?: string; delta?: string; error?: { message?: string }; response?: { error?: { message?: string } } };
      try { ev = JSON.parse(dataLine.slice(5).trim()); } catch { continue; }
      if (ev.type === "response.output_text.delta" && typeof ev.delta === "string") outputText += ev.delta;
      if (ev.type === "response.completed") outcome = ev.type;
      if (ev.type === "response.failed" || ev.type === "error") {
        outcome = `${ev.type}: ${ev.response?.error?.message ?? ev.error?.message ?? ""}`.trim();
      }
    }
  }
  return { ok: outcome === "response.completed", status: res.status, outputText: outputText.trim(), outcome };
}
