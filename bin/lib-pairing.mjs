// Shared pairing helper: renders the QR + token for an already-set-up machine.
// Used by `cato setup` (after onboarding) and `cato pair` (add another device).
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { homedir, hostname, networkInterfaces } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import qrcode from "qrcode-terminal";

const DIR = join(homedir(), ".cato");

/** A friendly pairing token, e.g. AB12-CD34 (no ambiguous 0/O/1/I). */
export function genToken() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let s = "";
  for (let i = 0; i < 8; i++) s += alphabet[bytes[i] % alphabet.length];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Ensure the agent key pair exists; return { publicKey, secretKey } (base64). */
function ensureKeys() {
  const file = join(DIR, "keys.json");
  try {
    const k = JSON.parse(readFileSync(file, "utf8"));
    if (k.publicKey && k.secretKey) return k;
  } catch { /* create below */ }
  const kp = nacl.box.keyPair();
  const k = { publicKey: naclUtil.encodeBase64(kp.publicKey), secretKey: naclUtil.encodeBase64(kp.secretKey) };
  try { mkdirSync(DIR, { recursive: true }); writeFileSync(file, JSON.stringify(k)); chmodSync(file, 0o600); } catch { /* best effort */ }
  return k;
}

/** Print a scannable QR (+ token) that pairs a phone to this machine. Returns false if
 *  the machine isn't set up yet. Identity travels as the agent's public key + machine-id,
 *  never the IP (which the app re-resolves via mDNS). */
export function showPairing() {
  let cfg;
  try { cfg = JSON.parse(readFileSync(join(DIR, "config.json"), "utf8")); } catch { cfg = {}; }
  const token = cfg.pairingToken;
  if (!token || token === "changeme") {
    console.log("\n  Not set up yet — run \x1b[1mcato setup\x1b[0m first.\n");
    return false;
  }
  const keys = ensureKeys();
  let host = hostname().replace(/\.local\.?$/i, "");
  try { if (process.platform === "darwin") host = execFileSync("scutil", ["--get", "ComputerName"], { encoding: "utf8" }).trim() || host; } catch { /* keep hostname */ }
  let machineId = "";
  try { machineId = readFileSync(join(DIR, "machine-id"), "utf8").trim(); } catch { /* set on first agent boot */ }
  const lanIp = Object.values(networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal)?.address ?? "127.0.0.1";
  const addr = `ws://${lanIp}:8787/v1`;

  const payload = { v: 1, addr, id: machineId, host, pub: keys.publicKey, token };
  const link = `cato://pair?d=${naclUtil.encodeBase64(naclUtil.decodeUTF8(JSON.stringify(payload)))}`;
  console.log(`\n  \x1b[1mScan this in the Cato app to pair (end-to-end encrypted):\x1b[0m\n`);
  qrcode.generate(link, { small: true });
  console.log(`  Or enter the token manually:  \x1b[1m${token}\x1b[0m`);
  console.log(`  Reachable now at: ${addr}  (the app re-finds it by name if the IP changes)\n`);
  return true;
}
