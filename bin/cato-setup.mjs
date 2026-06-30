#!/usr/bin/env node
/**
 * `cato setup` — first-run onboarding on this machine. Asks where your projects live and
 * generates a pairing token, saved to ~/.cato/config.json (read by the desktop agent).
 * Idempotent: re-running keeps your existing token unless it's the insecure default.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { homedir, hostname, networkInterfaces } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import qrcode from "qrcode-terminal";

const DIR = join(homedir(), ".cato");
const FILE = join(DIR, "config.json");
const load = () => { try { return JSON.parse(readFileSync(FILE, "utf8")); } catch { return {}; } };
const expand = (p) => p.replace(/^~(?=$|\/)/, homedir());

function genToken() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I
  const bytes = randomBytes(8);
  let s = "";
  for (let i = 0; i < 8; i++) s += alphabet[bytes[i] % alphabet.length];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

const cfg = load();
const rl = createInterface({ input: stdin, output: stdout });

console.log("\n  \x1b[1mCato setup\x1b[0m\n");
const defRoot = cfg.workspaceRoot || homedir();
let root = expand(((await rl.question(`  Where do your projects live?  [${defRoot}]  `)) || "").trim() || defRoot);

if (!existsSync(root)) {
  const mk = ((await rl.question(`  ${root} doesn't exist. Create it? [Y/n]  `)) || "").trim().toLowerCase();
  if (mk === "" || mk === "y") mkdirSync(root, { recursive: true });
}
rl.close();

// Keep an existing real token; only generate when missing or still the default.
const token = cfg.pairingToken && cfg.pairingToken !== "changeme" ? cfg.pairingToken : genToken();
const next = { ...cfg, workspaceRoot: root, pairingToken: token };
mkdirSync(DIR, { recursive: true });
writeFileSync(FILE, JSON.stringify(next, null, 2) + "\n");

// Ensure the agent's long-term encryption key pair exists (for end-to-end encryption).
const keysFile = join(DIR, "keys.json");
let keys;
try {
  keys = JSON.parse(readFileSync(keysFile, "utf8"));
} catch {
  const kp = nacl.box.keyPair();
  keys = { publicKey: naclUtil.encodeBase64(kp.publicKey), secretKey: naclUtil.encodeBase64(kp.secretKey) };
  writeFileSync(keysFile, JSON.stringify(keys));
  try { chmodSync(keysFile, 0o600); } catch { /* best effort */ }
}

// Friendly machine name + LAN address for the QR.
let host = hostname().replace(/\.local\.?$/i, "");
try { if (process.platform === "darwin") host = execFileSync("scutil", ["--get", "ComputerName"], { encoding: "utf8" }).trim() || host; } catch { /* keep hostname */ }
let machineId = "";
try { machineId = readFileSync(join(DIR, "machine-id"), "utf8").trim(); } catch { /* set on first agent boot */ }
const lanIp = Object.values(networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal)?.address ?? "127.0.0.1";
const addr = `ws://${lanIp}:8787/v1`;

const payload = { v: 1, addr, id: machineId, host, pub: keys.publicKey, token };
const link = `cato://pair?d=${naclUtil.encodeBase64(naclUtil.decodeUTF8(JSON.stringify(payload)))}`;

console.log(`\n  \x1b[32m✓\x1b[0m Saved ${FILE}`);
console.log(`     Workspace: ${root}`);
if (/Documents|Desktop|Downloads/.test(root)) console.log(`     Note: macOS may prompt for permission to that folder the first time.`);
console.log(`\n  \x1b[1mScan this in the Cato app to pair (encrypted, one tap):\x1b[0m\n`);
qrcode.generate(link, { small: true });
console.log(`  Or enter the pairing token manually:  \x1b[1m${token}\x1b[0m`);
console.log(`  Address: ${addr}\n`);
