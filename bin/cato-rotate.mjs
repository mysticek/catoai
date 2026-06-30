#!/usr/bin/env node
/**
 * `cato rotate` — generate a NEW pairing token. This disconnects every previously paired
 * device at once (use it if you lose a phone). Re-pair your devices with the new QR/token.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { showPairing, genToken } from "./lib-pairing.mjs";

const DIR = join(homedir(), ".cato");
const FILE = join(DIR, "config.json");

let cfg;
try { cfg = JSON.parse(readFileSync(FILE, "utf8")); } catch { cfg = {}; }
if (!cfg.workspaceRoot) {
  console.log("\n  Not set up yet — run \x1b[1mcato setup\x1b[0m first.\n");
  process.exit(1);
}

mkdirSync(DIR, { recursive: true });
writeFileSync(FILE, JSON.stringify({ ...cfg, pairingToken: genToken() }, null, 2) + "\n");

console.log("\n  \x1b[1mCato rotate\x1b[0m — new pairing token generated.");
console.log("  \x1b[33m! All previously paired devices are now disconnected — re-pair below.\x1b[0m");
console.log("  \x1b[33m! Restart the agent to apply:\x1b[0m  npm run daemon:off && npm run daemon:on   (or restart `npm start`)");
showPairing();
