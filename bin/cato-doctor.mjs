#!/usr/bin/env node
/**
 * `cato doctor` — diagnose the local setup and print fixes. Read-only, safe to run anytime.
 */
import { existsSync, accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

const DIR = join(homedir(), ".cato");
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m, fix) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); if (fix) console.log(`      → ${fix}`); fails++; };
const warn = (m, fix) => { console.log(`  \x1b[33m!\x1b[0m ${m}`); if (fix) console.log(`      → ${fix}`); };
const has = (c) => { try { execSync(`command -v ${c}`, { stdio: "ignore" }); return true; } catch { return false; } };
let fails = 0;

console.log("\n  \x1b[1mCato doctor\x1b[0m\n");

// Node
const major = Number(process.versions.node.split(".")[0]);
major >= 20 ? ok(`Node ${process.versions.node}`) : bad(`Node ${process.versions.node} (<20)`, "install Node ≥20");

// CLI deps
has("tmux") ? ok("tmux") : bad("tmux missing", "brew install tmux (or apt/dnf/pacman)");
has("ffmpeg") ? ok("ffmpeg") : bad("ffmpeg missing", "brew install ffmpeg");
has("whisper-server") || has("whisper-cli") ? ok("whisper.cpp") : warn("whisper.cpp missing", "brew install whisper-cpp — voice STT off, typed commands still work");

// coding agents
has("claude") || has("codex") ? ok(`coding agent (${[has("claude") && "claude", has("codex") && "codex"].filter(Boolean).join(", ")})`) : bad("no coding agent", "install claude or codex");

// ollama + models
let tags = "";
try { tags = execSync("curl -s --max-time 2 http://localhost:11434/api/tags", { encoding: "utf8" }); ok("ollama running"); }
catch { bad("ollama not reachable", "start it: ollama serve"); }
for (const m of ["bge-m3", "gemma3:4b"]) tags.includes(m) ? ok(`model ${m}`) : (tags ? bad(`model ${m} missing`, `ollama pull ${m}`) : null);

// whisper model
existsSync(join(DIR, "models", "ggml-large-v3-turbo.bin")) ? ok("whisper model present") : warn("whisper model missing", "re-run install.sh or download ggml-large-v3-turbo.bin");

// onboarding / security
const cfgFile = join(DIR, "config.json");
if (existsSync(cfgFile)) {
  ok("onboarded (config.json)");
  try {
    const cfg = JSON.parse(execSync(`cat ${cfgFile}`, { encoding: "utf8" }));
    cfg.pairingToken && cfg.pairingToken !== "changeme" ? ok("secured (real pairing token)") : bad("insecure default token", "run: cato setup");
    cfg.workspaceRoot && existsSync(cfg.workspaceRoot) ? ok(`workspace ${cfg.workspaceRoot}`) : bad("workspace folder missing", "run: cato setup");
  } catch { bad("config.json unreadable", "run: cato setup"); }
} else { bad("not onboarded", "run: cato setup"); }
existsSync(join(DIR, "keys.json")) ? ok("encryption keys present") : warn("no encryption keys yet", "run: cato setup");

// DB dir
try { existsSync(DIR) && accessSync(DIR, constants.W_OK); ok("~/.cato writable (embedded DB)"); } catch { bad("~/.cato not writable", "fix permissions on ~/.cato"); }

// agent running?
try { execSync("curl -s --max-time 2 http://localhost:8787/info", { stdio: "ignore" }); ok("agent running on :8787"); }
catch { warn("agent not running", "start it: npm start (or npm run daemon:on)"); }

console.log(`\n  ${fails === 0 ? "\x1b[32mAll good.\x1b[0m" : `\x1b[31m${fails} issue(s) above.\x1b[0m`}\n`);
process.exit(fails === 0 ? 0 : 1);
