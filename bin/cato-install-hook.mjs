#!/usr/bin/env node
// Installs Cato's PreToolUse approval hook into a PROJECT's .claude/settings.json
// (project-scoped — only gates Claude sessions launched in this folder via `cato`,
// never the user's global claude or other sessions). Idempotent; won't clobber.
//   node cato-install-hook.mjs <projectDir> <wsPort>
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

const dir = process.argv[2] || process.cwd();
const port = process.argv[3] || "8787";
const path = join(dir, ".claude", "settings.json");

// Per-machine hook secret (shared with the agent) so only Cato's own hook — not any other
// local process — can post approval requests. Matches packages/desktop-agent util/hook-secret.
const secretFile = join(homedir(), ".cato", "hook-secret");
let secret;
try { secret = readFileSync(secretFile, "utf8").trim(); } catch { /* create below */ }
if (!secret) {
  secret = randomUUID().replace(/-/g, "");
  try { mkdirSync(dirname(secretFile), { recursive: true }); writeFileSync(secretFile, secret); chmodSync(secretFile, 0o600); } catch { /* best effort */ }
}
const url = `http://127.0.0.1:${port}/hooks/pretooluse?s=${secret}`;

let s = {};
if (existsSync(path)) {
  try { s = JSON.parse(readFileSync(path, "utf8")); }
  catch { process.exit(0); } // present but unparseable → leave it alone
}
s.hooks ??= {};
s.hooks.PreToolUse ??= [];
if (s.hooks.PreToolUse.some((e) => JSON.stringify(e).includes("/hooks/pretooluse"))) process.exit(0);

s.hooks.PreToolUse.push({
  matcher: "Bash|Edit|Write|MultiEdit|WebFetch",
  hooks: [{ type: "http", url, timeout: 600 }],
});
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, JSON.stringify(s, null, 2) + "\n");
console.error(`cato: approval hook installed in ${path}`);
