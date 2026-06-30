/**
 * Desktop Agent entrypoint — the heart of Cato.
 * Wires: config → DB/Memory Engine → Orchestrator (tmux worker control) → Event Bus
 * → WebSocket server. Memory ingestion from live workers runs via the capture CLI /
 * Agent Manager (Phase 1); STT/TTS audio lands in Phase 4.
 */

import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { EventBus } from "./bus/event-bus.js";
import { MemoryEngine } from "./memory/memory-engine.js";
import { createEmbedder } from "./memory/embeddings.js";
import { Orchestrator, type WorkerControl } from "./orchestrator/orchestrator.js";
import { AgentManager } from "./agents/manager.js";
import { RecoveryMonitor } from "./recovery/monitor.js";
import { WsServer } from "./ws/server.js";
import { createStt, ensureWhisperServer } from "./voice/stt.js";
import { createLlm } from "./voice/llm.js";
import { sendLine, sendKey, capturePaneVisible, capturePaneScreen, resizeWindow, autoSizeWindow, killSession, openInTerminal } from "./tmux/tmux.js";
import { advertiseCato } from "./discovery/advertise.js";
import { friendlyHost, asciiHost } from "./util/host.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const bus = new EventBus();
  const pool = await createPool(config.dbDir);
  const embedder = await createEmbedder({ dim: config.embeddingDim, model: config.embeddingModel });
  // Memory routes every appended event to the bus → live push + reactions.
  const memory = new MemoryEngine(pool, embedder, (e) => bus.emit(e));
  console.log(`[cato] embeddings: ${embedder.kind} (dim ${embedder.dim})`);

  const llm = await createLlm(config.llmModel);
  console.log(`[cato] LLM: ${llm ? llm.kind + " (" + config.llmModel + ")" : "none (no chat model)"}`);

  // Agent Manager: the always-on process WATCHES workers itself (auto-discovers user
  // tmux sessions, captures output, and detects conversational questions they wait on).
  const manager = new AgentManager(memory, {
    workspaceRoot: config.workspaceRoot,
    llm: llm ?? undefined,
    onLog: (m) => console.log(`[agents] ${m}`),
  });

  // Worker control is tmux in practice: text via send-keys, "stop" via Ctrl-C,
  // raw keys + a rendered screen snapshot for the live terminal mirror.
  const control: WorkerControl = {
    send: (target, text) => sendLine(target, text),
    interrupt: (target) => sendKey(target, "C-c"),
    key: (target, key) => sendKey(target, key),
    screen: (target) => capturePaneScreen(target, 400).then((s) => s ?? ""),
    resize: (target, cols, rows) => resizeWindow(target, cols, rows),
    autoSize: (target) => autoSizeWindow(target),
    kill: (target) => killSession(target),
    openDesktop: (target) => openInTerminal(target, config.desktopTerminal),
  };
  const orchestrator = new Orchestrator(memory, control, {
    spawnWorker: (kind, project) => manager.spawnForProject(kind, project),
    llm: llm ?? undefined,
  });

  // Worker recovery: detect crashes and resurrect workers from checkpoints.
  const recovery = new RecoveryMonitor(memory, control, { onLog: (m) => console.log(m) });
  recovery.start();

  // Keep whisper warm (model loaded) so STT is ~1s instead of a cold start each call.
  await ensureWhisperServer(config.sttModel, config.sttServerUrl).catch(() => false);
  const stt = await createStt({ bin: config.sttBin, model: config.sttModel, serverUrl: config.sttServerUrl });
  console.log(`[cato] STT: ${stt ? stt.kind : "disabled (no whisper model)"}`);

  const ws = new WsServer(config, bus, orchestrator, stt ?? undefined, llm ?? undefined);
  ws.start();

  // Wire conversational-question flow: manager detects → phones; phones answer → agent.
  manager.setOnQuestion((q) => ws.pushQuestion(q));
  // A live prompt (native approve / a menu) → mark that project WAITING on the phones.
  manager.setOnWaiting((projects) => ws.setWaiting(projects));
  // A session opened/closed on the desktop → refresh the phones' project lists.
  manager.setOnChange(() => ws.broadcastStatus());
  ws.setQuestionResolver((id, i) => void manager.answerQuestion(id, i));
  ws.setSpawnHandler((kind, path, task) => void manager.spawnForProject(kind, path, task));
  manager.start();

  // Announce on the LAN so phones discover this machine automatically (no IP typing).
  const stopAdvertise = advertiseCato(config.wsPort, asciiHost(), "0.0.0");

  console.log("[cato] desktop agent up. Cato remembers. Workers implement.");

  const shutdown = async () => {
    console.log("\n[cato] shutting down…");
    stopAdvertise();
    recovery.stop();
    await manager.stop();
    await ws.stop();
    await pool.end().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[cato] fatal:", err);
  process.exit(1);
});
