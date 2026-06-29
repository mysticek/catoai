/**
 * Cato capture CLI — exercise the "own memory" pipeline end-to-end.
 *
 *   cli ingest <file> [--project name] [--from-start]   tail any stream into memory
 *   cli spawn  <kind> [--cwd dir] [--project name]      Cato starts a worker (managed)
 *   cli adopt  <tmux-target> [--project name]           attach to a worker YOU started in tmux
 *   cli sessions                                        list tmux sessions available to adopt
 *   cli send   <tmux-target> <text...>                  inject input via tmux send-keys
 *   cli status                                          what is happening (from memory)
 *
 * kind ∈ claude-code | codex | gemini-cli   (or: spawn <kind> --command <cmd>)
 */

import { homedir } from "node:os";
import { join, basename } from "node:path";
import { mkdir } from "node:fs/promises";
import { ulid } from "ulid";
import { loadConfig } from "../config.js";
import { createPool } from "../db.js";
import { MemoryEngine } from "../memory/memory-engine.js";
import { createEmbedder } from "../memory/embeddings.js";
import { FileTailSource } from "../capture/file-tail.js";
import { SnapshotCaptureSource } from "../capture/snapshot.js";
import type { CaptureSource } from "../capture/source.js";
import { TerminalAgent } from "../agents/terminal-agent.js";
import { PROFILES } from "../agents/profiles.js";
import {
  hasTmux,
  hasSession,
  sendLine,
  pipePaneToFile,
  capturePaneHistory,
  listAllSessions,
  listSessions,
} from "../tmux/tmux.js";

const CAPTURE_DIR = join(homedir(), ".cato", "capture");

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

/** Positional args only — drops `--flag value` pairs (value flags). */
function positional(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i]!.startsWith("--")) {
      i++; // skip the flag's value
      continue;
    }
    out.push(args[i]!);
  }
  return out;
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const embedder = await createEmbedder({ dim: config.embeddingDim });
  const memory = new MemoryEngine(pool, embedder);
  await mkdir(CAPTURE_DIR, { recursive: true });

  switch (cmd) {
    case "ingest":
      await cmdIngest(memory, rest);
      break;
    case "spawn":
      await cmdSpawn(memory, rest);
      break;
    case "adopt":
      await cmdAdopt(memory, rest);
      break;
    case "sessions":
      await cmdSessions();
      break;
    case "send":
      await cmdSend(rest);
      break;
    case "checkpoint":
      await cmdCheckpoint(memory, rest);
      break;
    case "remember":
      await cmdRemember(memory, rest, embedder.kind);
      break;
    case "recall":
      await cmdRecall(memory, rest, embedder.kind);
      break;
    case "status":
      await cmdStatus(memory);
      break;
    default:
      console.log(
        "usage: cli <ingest|spawn|adopt|sessions|send|checkpoint|remember|recall|status> ...",
      );
  }
  await pool.end().catch(() => {});
}

async function cmdIngest(memory: MemoryEngine, args: string[]): Promise<void> {
  const file = args[0];
  if (!file) throw new Error("ingest: <file> required");
  const projectName = flag(args, "project") ?? basename(file).replace(/\.\w+$/, "");
  const fromStart = args.includes("--from-start");

  const projectId = await memory.ensureProject(projectName, process.cwd());
  const workerId = await memory.startWorker({
    projectId, projectName, agentKind: "file-ingest", sessionId: basename(file),
  });
  console.log(`[ingest] project=${projectName} worker=${workerId} <- ${file}`);
  console.log(`[ingest] tailing… (Ctrl-C to stop)\n`);

  const source = new FileTailSource(file, { fromStart });
  process.on("SIGINT", async () => {
    source.close();
    await memory.stopWorker(workerId, projectId, projectName, "clean");
    process.exit(0);
  });

  for await (const line of source.lines()) {
    const res = await memory.ingestLine(line, { workerId, projectId, projectName });
    for (const ev of res.events) console.log(`  ▶ EVENT ${ev.type} :: ${ev.summary}`);
    if (res.importance >= 0.6) console.log(`  · [${res.importance.toFixed(2)}] ${res.content}`);
  }
}

async function cmdSpawn(memory: MemoryEngine, args: string[]): Promise<void> {
  const kind = args[0] ?? "claude-code";
  const commandOverride = flag(args, "command");
  const profile = commandOverride ? { kind, command: commandOverride } : PROFILES[kind];
  if (!profile) throw new Error(`unknown kind: ${kind} (have: ${Object.keys(PROFILES).join(", ")})`);
  if (!(await hasTmux())) throw new Error("tmux not found — install it: brew install tmux");

  const cwd = flag(args, "cwd") ?? process.cwd();
  const projectName = flag(args, "project") ?? basename(cwd);
  const sessionId = ulid();

  const agent = new TerminalAgent(profile, CAPTURE_DIR);
  const session = await agent.spawn(sessionId, cwd);
  const projectId = await memory.ensureProject(projectName, cwd);
  const workerId = await memory.startWorker({
    projectId, projectName, agentKind: kind, sessionId,
    tmuxTarget: session.tmuxTarget, launchCommand: profile.command,
  });

  console.log(`[spawn] ${kind} in tmux ${session.tmuxTarget} (cwd=${cwd})`);
  console.log(`[spawn] attach:  tmux attach -t ${session.tmuxTarget}`);
  console.log(`[spawn] send:    npm run cli -w @cato/desktop-agent -- send ${session.tmuxTarget} "your message"`);
  console.log(`[spawn] capturing into memory… (Ctrl-C to stop tailing; worker keeps running)\n`);

  process.on("SIGINT", async () => {
    await memory.stopWorker(workerId, projectId, projectName, "clean");
    process.exit(0);
  });

  for await (const ev of agent.watchEvents(sessionId)) {
    if (!ev.text) continue;
    const res = await memory.ingestLine(ev.text, { workerId, projectId, projectName });
    for (const e of res.events) console.log(`  ▶ EVENT ${e.type} :: ${e.summary}`);
  }
}

/**
 * Adopt a worker YOU started in tmux: backfill its scrollback into memory, then
 * stream it live. This is the "work in the terminal, then walk away" path — Cato
 * did not spawn it. Requires the worker to be running inside tmux.
 */
async function cmdAdopt(memory: MemoryEngine, args: string[]): Promise<void> {
  const target = args[0];
  if (!target) throw new Error("adopt: <tmux-target> required (see: cli sessions)");
  if (!(await hasTmux())) throw new Error("tmux not found — install it: brew install tmux");
  const sessionName = target.split(/[:.]/)[0]!;
  if (!(await hasSession(sessionName))) throw new Error(`no tmux session: ${sessionName}`);

  const projectName = flag(args, "project") ?? sessionName;
  const safeId = target.replace(/[^A-Za-z0-9_-]/g, "_");
  const captureFile = join(CAPTURE_DIR, `${safeId}.log`);

  const projectId = await memory.ensureProject(projectName, process.cwd());
  const workerId = await memory.startWorker({
    projectId, projectName, agentKind: "adopted", sessionId: safeId, tmuxTarget: target,
  });
  console.log(`[adopt] attached to tmux ${target} as project=${projectName} worker=${workerId}`);

  // 1) backfill existing scrollback into memory
  const history = await capturePaneHistory(target);
  const histLines = history.split("\n").filter((l) => l.trim().length > 0);
  let backfilled = 0;
  for (const line of histLines) {
    const res = await memory.ingestLine(line, { workerId, projectId, projectName });
    if (res.events.length) for (const e of res.events) console.log(`  ⏪ backfill EVENT ${e.type} :: ${e.summary}`);
    backfilled++;
  }
  console.log(`[adopt] backfilled ${backfilled} scrollback lines`);

  // 2) go live. Interactive TUI agents (claude) → snapshot the rendered grid
  //    (clean spacing); plain line-oriented programs → pipe-pane byte stream.
  const useSnapshot = args.includes("--snapshot");
  let source: CaptureSource;
  if (useSnapshot) {
    source = new SnapshotCaptureSource(target, { pollMs: 1000 });
    console.log(`[adopt] live capturing via capture-pane snapshots (TUI mode)\n`);
  } else {
    await pipePaneToFile(target, captureFile);
    source = new FileTailSource(captureFile, { fromStart: false });
    console.log(`[adopt] live capturing via pipe-pane… (Ctrl-C to detach; worker keeps running)\n`);
  }
  process.on("SIGINT", async () => {
    source.close();
    await memory.stopWorker(workerId, projectId, projectName, "clean");
    process.exit(0);
  });
  for await (const line of source.lines()) {
    const res = await memory.ingestLine(line, { workerId, projectId, projectName });
    for (const e of res.events) console.log(`  ▶ EVENT ${e.type} :: ${e.summary}`);
  }
}

async function cmdSessions(): Promise<void> {
  if (!(await hasTmux())) throw new Error("tmux not found — install it: brew install tmux");
  const mine = new Set(await listSessions());
  const all = await listAllSessions();
  console.log("=== tmux sessions ===");
  if (all.length === 0) console.log("(none — start one: tmux new -s mywork)");
  for (const s of all) console.log(`  ${mine.has(s) ? "[managed]" : "[adoptable]"} ${s}`);
}

async function cmdSend(args: string[]): Promise<void> {
  const target = args[0];
  const text = args.slice(1).join(" ");
  if (!target || !text) throw new Error("send: <tmux-target> <text...> required");
  await sendLine(target, text);
  console.log(`[send] -> ${target}: ${text}`);
}

async function cmdCheckpoint(memory: MemoryEngine, args: string[]): Promise<void> {
  const projectName = args[0];
  const state = args.slice(1).join(" ");
  if (!projectName || !state) throw new Error("checkpoint: <project> <text...> required");
  const projectId = await memory.ensureProject(projectName, process.cwd());
  await memory.saveCheckpoint(projectId, state);
  console.log(`[checkpoint] ${projectName} <- ${state}`);
}

async function cmdRemember(memory: MemoryEngine, args: string[], embKind: string): Promise<void> {
  const content = positional(args).join(" ");
  if (!content) throw new Error("remember: <text...> required");
  const projectName = flag(args, "project");
  const kind = (flag(args, "kind") as "decision" | "knowledge" | "summary" | "preference") ?? "knowledge";
  const projectId = projectName ? await memory.ensureProject(projectName, process.cwd()) : undefined;
  await memory.remember({ projectId, kind, content });
  console.log(`[remember:${embKind}] (${kind}${projectName ? " @" + projectName : ""}) ${content}`);
}

async function cmdRecall(memory: MemoryEngine, args: string[], embKind: string): Promise<void> {
  const query = positional(args).join(" ");
  if (!query) throw new Error("recall: <query...> required");
  const projectName = flag(args, "project");
  const results = await memory.retrieve(query, { projectName, limit: 5 });
  console.log(`=== recall (${embKind}): "${query}" ===`);
  if (results.length === 0) console.log("  (nothing relevant in memory)");
  for (const r of results) {
    console.log(`  [sim ${r.similarity.toFixed(3)} | imp ${r.importance.toFixed(2)}] ${r.kind}: ${r.content}`);
  }
}

async function cmdStatus(memory: MemoryEngine): Promise<void> {
  const statuses = await memory.projectStatuses();
  console.log("=== What is happening? ===");
  if (statuses.length === 0) console.log("(no projects in memory yet)");
  for (const s of statuses) console.log(`  [${s.state.padEnd(9)}] ${s.name}: ${s.summary}`);
  console.log("\n=== recent events ===");
  for (const e of await memory.recentEvents(10)) {
    console.log(`  ${e.ts}  ${e.type.padEnd(18)} ${e.summary ?? ""}`);
  }
}

main().catch((err) => {
  console.error("error:", err.message);
  process.exit(1);
});
