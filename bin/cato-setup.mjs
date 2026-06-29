#!/usr/bin/env node
/**
 * `cato setup` — first-run onboarding on this machine. Asks where your projects live and
 * generates a pairing token, saved to ~/.cato/config.json (read by the desktop agent).
 * Idempotent: re-running keeps your existing token unless it's the insecure default.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

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
const defRoot = cfg.workspaceRoot || join(homedir(), "dev");
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

console.log(`\n  \x1b[32m✓\x1b[0m Saved ${FILE}`);
console.log(`     Workspace root: ${root}`);
console.log(`     Pairing token:  \x1b[1m${token}\x1b[0m   ← enter this in the Cato app to connect`);
if (/Documents|Desktop|Downloads/.test(root)) {
  console.log(`     Note: macOS may prompt for permission to that folder the first time.`);
}
console.log("");
