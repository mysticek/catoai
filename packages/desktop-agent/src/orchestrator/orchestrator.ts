/**
 * Orchestrator — decides what happens for a voice command. Resolves the target
 * project/worker, reads from the Memory Engine, and routes actions to workers.
 * Workers only execute; the Orchestrator owns the decision. See docs/ARCHITECTURE.md §2.2.
 */

import type { CommandTarget, ProjectStatus } from "@cato/shared";
import type { MemoryEngine } from "../memory/memory-engine.js";
import type { Llm, ClassifiedIntent } from "../voice/llm.js";
import type { Intent } from "./intent.js";
import * as say from "./phrasing.js";

/** How the Orchestrator talks to live workers (injected — tmux in practice). */
export interface WorkerControl {
  send(tmuxTarget: string, text: string): Promise<void>;
  interrupt(tmuxTarget: string): Promise<void>;
}

/** Optional capabilities the Orchestrator uses when available. */
export interface OrchestratorDeps {
  /** Voice-spawn a worker for a project (AgentManager.spawnForProject). */
  spawnWorker?: (agentKind: string, project: string) => Promise<{ ok: boolean; reason?: string }>;
  /** Local LLM for natural-language summaries. */
  llm?: Llm;
}

export interface OrchestratorReply {
  /** Slovak (by default) text for TTS. */
  speak: string;
  locale: string;
  /** Present for status queries — drives `status.update`. */
  statuses?: ProjectStatus[];
}

export class Orchestrator {
  #lastSpoken: string | undefined;

  constructor(
    private readonly memory: MemoryEngine,
    private readonly control: WorkerControl,
    private readonly deps: OrchestratorDeps = {},
  ) {}

  /** Handle a free-form voice command. */
  async handleCommand(
    text: string,
    locale: string,
    target?: CommandTarget,
  ): Promise<OrchestratorReply> {
    await this.memory
      .appendEvent({
        type: "VoiceCommandReceived",
        importance: 0.3,
        summary: `voice: ${text}`,
        data: { text, locale, target },
      })
      .catch(() => {});

    // No regex — the model classifies the command (any phrasing, en/sk/cs).
    let intent: Intent = { kind: "unknown", text };
    if (this.deps.llm) {
      const projects = await this.memory.listProjects().catch(() => []);
      const c = await this.deps.llm.classifyIntent(text, projects).catch(() => null);
      if (c) intent = this.#fromClassified(c, text);
    }
    return this.run(this.applyTarget(intent, target), locale);
  }

  /** Map the LLM's structured classification onto a typed Intent. */
  #fromClassified(c: ClassifiedIntent, text: string): Intent {
    switch (c.kind) {
      case "status": return { kind: "status" };
      case "projectStatus": return c.project ? { kind: "projectStatus", project: c.project } : { kind: "status" };
      case "tell": return { kind: "tell", project: c.project, message: c.message || text };
      case "continue": return { kind: "continue", project: c.project };
      case "stop": return { kind: "stop", project: c.project };
      case "repeat": return { kind: "repeat" };
      case "summarize": return { kind: "summarize" };
      case "spawnWorker":
        return c.project ? { kind: "spawnWorker", agentKind: c.agentKind || "claude-code", project: c.project } : { kind: "unknown", text };
      default: return { kind: "unknown", text };
    }
  }

  /** Handle an explicit control button (continue/stop/repeat/summarize). */
  async handleControl(
    action: "continue" | "stop" | "repeat" | "summarize",
    locale: string,
    target?: CommandTarget,
  ): Promise<OrchestratorReply> {
    const intent = this.applyTarget({ kind: action } as Intent, target);
    return this.run(intent, locale);
  }

  private applyTarget(intent: Intent, target?: CommandTarget): Intent {
    if (target?.project && (intent.kind === "tell" || intent.kind === "continue" || intent.kind === "stop")) {
      if (!intent.project) return { ...intent, project: target.project };
    }
    return intent;
  }

  private async run(intent: Intent, locale: string): Promise<OrchestratorReply> {
    const reply = await this.dispatch(intent, locale);
    if (intent.kind !== "repeat") this.#lastSpoken = reply.speak;
    return reply;
  }

  private async dispatch(intent: Intent, locale: string): Promise<OrchestratorReply> {
    switch (intent.kind) {
      case "status": {
        const statuses = await this.memory.projectStatuses();
        return { speak: say.sayStatus(statuses, locale), locale, statuses };
      }
      case "projectStatus": {
        // "How is X doing?" — summarize the LIVE captured output (works in-progress).
        if (this.deps.llm) {
          const tail = await this.memory.recentCapture(intent.project, 60);
          if (tail.length) {
            const text = await this.deps.llm.describeActivity(intent.project, tail, locale).catch(() => "");
            if (text) return { speak: text, locale };
          }
        }
        // Fallback: latest event + active task.
        const events = await this.memory.recentEvents(5, intent.project);
        const task = await this.memory.activeTask(intent.project);
        return { speak: say.sayProjectStatus(intent.project, events, task?.intent, locale), locale };
      }
      case "summarize": {
        const events = await this.memory.recentEvents(10, undefined, ["VoiceCommandReceived"]);
        if (this.deps.llm && events.length) {
          const text = await this.deps.llm
            .summarize(events.map((e) => e.summary ?? e.type), locale)
            .catch(() => "");
          if (text) {
            await this.memory.remember({ kind: "summary", content: text, importance: 0.5 }).catch(() => {});
            return { speak: text, locale };
          }
        }
        return { speak: say.saySummary(events, locale), locale };
      }
      case "spawnWorker": {
        if (!this.deps.spawnWorker) return { speak: say.sayNoSpawn(locale), locale };
        const res = await this.deps.spawnWorker(intent.agentKind, intent.project);
        return res.ok
          ? { speak: say.saySpawned(intent.agentKind, intent.project, locale), locale }
          : { speak: say.saySpawnFailed(res.reason ?? "unknown error", locale), locale };
      }
      case "tell": {
        const w = await this.memory.runningWorker(intent.project);
        if (!w?.tmuxTarget) return { speak: say.sayNoWorker(locale), locale };
        // Retrieval: inject a compact slice of relevant memory so the worker benefits
        // from "how we did this before". Workers never get the full memory.
        const mems = await this.memory.retrieve(intent.message, { projectName: w.project, limit: 3 });
        const relevant = mems.filter((m) => m.similarity >= 0.55);
        let payload = intent.message;
        if (relevant.length) {
          const ctx = relevant.map((m) => m.content).join(" | ");
          payload = `[Cato memory context: ${ctx}] ${intent.message}`;
        }
        await this.control.send(w.tmuxTarget, payload);
        if (w.taskId) await this.memory.setTaskIntent(w.taskId, intent.message).catch(() => {});
        return { speak: say.sayTold(w.project, relevant.length > 0, locale), locale };
      }
      case "continue": {
        const w = await this.memory.runningWorker(intent.project);
        if (!w?.tmuxTarget) return { speak: say.sayNoWorker(locale), locale };
        await this.control.send(w.tmuxTarget, "continue");
        return { speak: say.sayContinued(w.project, locale), locale };
      }
      case "stop": {
        const w = await this.memory.runningWorker(intent.project);
        if (!w?.tmuxTarget) return { speak: say.sayNoWorker(locale), locale };
        await this.control.interrupt(w.tmuxTarget);
        await this.memory
          .appendEvent({
            type: "DecisionMade",
            project: w.project,
            workerId: w.workerId,
            importance: 0.6,
            summary: `${w.project}: stopped by user`,
            data: { taskId: "", decision: "stop" },
          })
          .catch(() => {});
        return { speak: say.sayStopped(w.project, locale), locale };
      }
      case "repeat":
        return { speak: this.#lastSpoken ?? say.sayNothingToRepeat(locale), locale };
      case "unknown":
        return { speak: say.sayUnknown(locale), locale };
    }
  }
}
