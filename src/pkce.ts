import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface PkcePair {
  verifier: string;
  challenge: string;
}

/** 32 random bytes -> 43 base64url chars (within the 43-128 RFC 7636 range). */
export function generatePkce(): PkcePair {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function generateState(): string {
  return crypto.randomBytes(16).toString("base64url");
}

export const CONFIG_DIR = path.join(os.homedir(), ".chatgpt-cli");
const HOST_ID_FILE = path.join(CONFIG_DIR, "host_id");
const URN_UUID_RE = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Persistent per-machine identifier, cached in ~/.chatgpt-cli/host_id. */
export function loadOrCreateHostId(): string {
  try {
    const existing = fs.readFileSync(HOST_ID_FILE, "utf8").trim();
    if (URN_UUID_RE.test(existing)) return existing;
  } catch {
    // missing or unreadable: fall through and create a new one
  }
  const hostId = `urn:uuid:${crypto.randomUUID()}`;
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(HOST_ID_FILE, hostId + "\n", { mode: 0o600 });
  return hostId;
}
