/**
 * The desktop agent's long-term encryption key pair, persisted to ~/.cato/keys.json.
 * Its public key is pinned by the phone during QR pairing; the secret key never leaves
 * this machine. Used for the end-to-end encrypted handshake (see @cato/shared/crypto).
 */
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { generateKeyPair, type KeyPairB64 } from "@cato/shared";

let cached: KeyPairB64 | undefined;

export function agentKeys(): KeyPairB64 {
  if (cached) return cached;
  const dir = join(homedir(), ".cato");
  const file = join(dir, "keys.json");
  try {
    const k = JSON.parse(readFileSync(file, "utf8")) as KeyPairB64;
    if (k.publicKey && k.secretKey) return (cached = k);
  } catch {
    /* not created yet */
  }
  cached = generateKeyPair();
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(cached), "utf8");
    chmodSync(file, 0o600); // secret key: owner-only
  } catch {
    /* in-memory only if disk fails */
  }
  return cached;
}
