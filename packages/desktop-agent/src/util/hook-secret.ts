/**
 * Per-machine secret shared between the agent and its own PreToolUse hook, so only the
 * hook installed by `cato` (which knows the secret) can post approval requests — not any
 * other local process. Persisted to ~/.cato/hook-secret. The `cato` launcher reads the
 * same file and appends it to the hook URL (?s=…).
 */
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ulid } from "ulid";

let cached: string | undefined;

export function hookSecret(): string {
  if (cached) return cached;
  const dir = join(homedir(), ".cato");
  const file = join(dir, "hook-secret");
  try {
    const s = readFileSync(file, "utf8").trim();
    if (s) return (cached = s);
  } catch {
    /* not created yet */
  }
  cached = ulid();
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, cached, "utf8");
    chmodSync(file, 0o600);
  } catch {
    /* in-memory only if disk fails */
  }
  return cached;
}
