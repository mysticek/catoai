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
import { createStt } from "./voice/stt.js";
import { createLlm } from "./voice/llm.js";
import { sendLine, sendKey } from "./tmux/tmux.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const bus = new EventBus();
  const pool = createPool(config.databaseUrl);
  const embedder = await createEmbedder({ dim: config.embeddingDim, model: config.embeddingModel });
  // Memory routes every appended event to the bus → live push + reactions.
  const memory = new MemoryEngine(pool, embedder, (e) => bus.emit(e));
  console.log(`[cato] embeddings: ${embedder.kind} (dim ${embedder.dim})`);

  // Agent Manager: the always-on process WATCHES workers itself (auto-discovers
  // user tmux sessions, captures their output into memory via rendered snapshots).
  const manager = new AgentManager(memory, {
    workspaceRoot: config.workspaceRoot,
    onLog: (m) => console.log(`[agents] ${m}`),
  });
  manager.start();

  const llm = await createLlm(config.llmModel);
  console.log(`[cato] LLM summaries: ${llm ? llm.kind + " (" + config.llmModel + ")" : "heuristic (no chat model)"}`);

  // Worker control is tmux in practice: text via send-keys, "stop" via Ctrl-C.
  const control: WorkerControl = {
    send: (target, text) => sendLine(target, text),
    interrupt: (target) => sendKey(target, "C-c"),
  };
  const orchestrator = new Orchestrator(memory, control, {
    spawnWorker: (kind, project) => manager.spawnForProject(kind, project),
    llm: llm ?? undefined,
  });

  // Worker recovery: detect crashes and resurrect workers from checkpoints.
  const recovery = new RecoveryMonitor(memory, control, {
    onLog: (m) => console.log(m),
  });
  recovery.start();

  const stt = createStt(config.sttBin, config.sttModel);
  console.log(`[cato] STT: ${stt ? stt.kind : "disabled (no whisper model)"}`);

  const ws = new WsServer(config, bus, orchestrator, stt ?? undefined);
  ws.start();

  console.log("[cato] desktop agent up. Cato remembers. Workers implement.");

  const shutdown = async () => {
    console.log("\n[cato] shutting down…");
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
