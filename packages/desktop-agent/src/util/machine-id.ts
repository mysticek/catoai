/**
 * A stable per-machine id, persisted in ~/.cato/machine-id. Sent in /info, welcome and
 * mDNS so the phone can dedupe machines by identity (not by IP, which changes with DHCP).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ulid } from "ulid";

let cached: string | undefined;

export function machineId(): string {
  if (cached) return cached;
  const dir = join(homedir(), ".cato");
  const file = join(dir, "machine-id");
  try {
    const existing = readFileSync(file, "utf8").trim();
    if (existing) return (cached = existing);
  } catch {
    /* not created yet */
  }
  cached = ulid();
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, cached, "utf8");
  } catch {
    /* in-memory only if disk fails */
  }
  return cached;
}
