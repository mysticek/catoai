/**
 * AgentManager — makes the always-on desktop agent actually WATCH workers itself
 * (docs/ARCHITECTURE.md §2.5). It auto-discovers user-started tmux sessions, captures
 * their output into the Memory Engine, and (because the Memory Engine routes every
 * appended event to the Event Bus) surfaces notable events live.
 *
 * Scope split: user sessions (any tmux session NOT prefixed `cato_`) are ADOPTED
 * and captured here via rendered snapshots (clean for TUIs like claude). Sessions
 * spawned by Cato (`cato_*`) are managed by the spawn/recovery path.
 */

import { join, basename, resolve, sep } from "node:path";
import { existsSync } from "node:fs";
import { ulid } from "ulid";
import type { AgentQuestion } from "@cato/shared";
import type { MemoryEngine } from "../memory/memory-engine.js";
import type { Llm } from "../voice/llm.js";
import { SnapshotCaptureSource } from "../capture/snapshot.js";
import type { CaptureSource } from "../capture/source.js";
import { PROFILES } from "./profiles.js";
import { parseMenu } from "./menu.js";
import {
  listAllSessions, capturePaneHistory, capturePaneVisible, newShellSession, sendLine, sendKey,
  SESSION_PREFIX, ADOPT_PREFIX,
} from "../tmux/tmux.js";

interface Tracked {
  workerId: string;
  projectId: string;
  projectName: string;
  source: CaptureSource;
  lastVisible: string;
  stable: number;
  questionId?: string;
}

export interface SpawnResult {
  ok: boolean;
  reason?: string;
  cwd?: string;
}

export interface AgentManagerOptions {
  discoverMs?: number;
  /** Where to look for project folders when voice-spawning a worker. */
  workspaceRoot?: string;
  /** LLM used to detect conversational questions an agent is waiting on. */
  llm?: Llm;
  onLog?: (msg: string) => void;
}

export class AgentManager {
  #tracked = new Map<string, Tracked>(); // key: tmux session name
  #pendingQuestions = new Map<string, { target: string; numbers: number[] }>();
  #onQuestion: (q: AgentQuestion) => void = () => {};
  #timer: ReturnType<typeof setInterval> | undefined;
  #busy = false;
  readonly #discoverMs: number;
  readonly #workspaceRoot: string;
  readonly #llm: Llm | undefined;
  readonly #log: (m: string) => void;

  constructor(
    private readonly memory: MemoryEngine,
    opts: AgentManagerOptions = {},
  ) {
    this.#discoverMs = opts.discoverMs ?? 2500;
    this.#workspaceRoot = opts.workspaceRoot ?? process.cwd();
    this.#llm = opts.llm;
    this.#log = opts.onLog ?? (() => {});
  }

  /** Called when an agent is waiting on a conversational choice → push to phones. */
  setOnQuestion(fn: (q: AgentQuestion) => void): void {
    this.#onQuestion = fn;
  }

  /** Answer a pending conversational question by sending the chosen option's number key. */
  async answerQuestion(id: string, optionIndex: number): Promise<void> {
    const p = this.#pendingQuestions.get(id);
    if (!p) return;
    this.#pendingQuestions.delete(id);
    for (const t of this.#tracked.values()) if (t.questionId === id) t.questionId = undefined;
    await sendKey(p.target, String(p.numbers[optionIndex] ?? optionIndex + 1));
  }

  start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => void this.#tick(), this.#discoverMs);
    void this.#tick();
  }

  async #tick(): Promise<void> {
    await this.#discover();
    await this.#checkQuestions();
  }

  /** Surface a LIVE interactive menu (deterministic — numbered options + nav footer on the
   *  current screen). No LLM, so it can't hallucinate a menu from scrollback. */
  async #checkQuestions(): Promise<void> {
    for (const [session, t] of this.#tracked) {
      const vis = (await capturePaneVisible(session)) ?? "";
      if (vis !== t.lastVisible) {
        t.lastVisible = vis;
        if (t.questionId) { this.#pendingQuestions.delete(t.questionId); t.questionId = undefined; }
      }
      const menu = parseMenu(vis);
      if (menu && !t.questionId) {
        const id = ulid();
        t.questionId = id;
        this.#pendingQuestions.set(id, { target: session, numbers: menu.numbers });
        this.#onQuestion({ id, project: t.projectName, question: menu.question, options: menu.options });
        this.#log(`question on ${t.projectName}: ${menu.question} [${menu.options.join(" / ")}]`);
      } else if (!menu && t.questionId) {
        // The menu is gone (answered/dismissed) → clear so stale cards don't linger.
        this.#pendingQuestions.delete(t.questionId);
        t.questionId = undefined;
      }
    }
  }

  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
    for (const t of this.#tracked.values()) t.source.close();
    this.#tracked.clear();
  }

  /** Discover new user sessions to adopt, and release ones that disappeared. */
  async #discover(): Promise<void> {
    if (this.#busy) return;
    this.#busy = true;
    try {
      const all = await listAllSessions();
      const live = new Set(all); // includes our cato_* spawned sessions
      // Adopt only sessions launched via the `cato` wrapper (cato-<project>),
      // never Cato-spawned (cato_*) nor unrelated user tmux sessions.
      const adoptable = all.filter((s) => s.startsWith(ADOPT_PREFIX));
      for (const s of adoptable) if (!this.#tracked.has(s)) await this.#adopt(s);
      for (const [s, t] of this.#tracked) {
        if (!live.has(s)) {
          t.source.close();
          this.#tracked.delete(s);
          await this.memory.stopWorker(t.workerId, t.projectId, t.projectName, "clean");
          this.#log(`released ${s}`);
        }
      }
    } finally {
      this.#busy = false;
    }
  }

  async #adopt(session: string): Promise<void> {
    const projectName = (session.startsWith(ADOPT_PREFIX) ? session.slice(ADOPT_PREFIX.length) : session).slice(0, 40) || session;
    const projectId = await this.memory.ensureProject(projectName, process.cwd());
    const taskId = await this.memory.createTask(projectId, "adoptovaná session");
    const workerId = await this.memory.startWorker({
      projectId, projectName, agentKind: "adopted", sessionId: session,
      tmuxTarget: session, taskId,
    });

    // Backfill existing scrollback (clean, rendered) once.
    const hist = await capturePaneHistory(session);
    for (const line of hist.split("\n")) {
      if (line.trim()) await this.memory.ingestLine(line, { workerId, projectId, projectName }).catch(() => {});
    }

    const source = new SnapshotCaptureSource(session, { pollMs: 1200 });
    this.#tracked.set(session, { workerId, projectId, projectName, source, lastVisible: "", stable: 0 });
    this.#log(`adopted ${session} (project=${projectName})`);
    void this.#ingest(source, { workerId, projectId, projectName });
  }

  /**
   * Voice-spawn a worker for a project: locate the project folder under the
   * workspace root, launch the agent in a fresh tmux session, capture it, and
   * register it (with launch_command, so recovery can resurrect it).
   */
  /** Launch an agent. `projectPath` may be a name or a nested path under the workspace
   *  root (e.g. "work/client/api"). Optional `task` is sent once the agent is ready. */
  async spawnForProject(agentKind: string, projectPath: string, task?: string): Promise<SpawnResult> {
    const profile = PROFILES[agentKind];
    if (!profile) return { ok: false, reason: `nepoznám agenta ${agentKind}` };
    // Sandbox: the spawn directory must stay under the workspace root (refuse ../ escapes).
    const root = resolve(this.#workspaceRoot);
    const cwd = resolve(root, projectPath);
    if (cwd !== root && !cwd.startsWith(root + sep)) return { ok: false, reason: `cesta mimo workspace` };
    if (!existsSync(cwd)) return { ok: false, reason: `nenašiel som priečinok ${projectPath}` };
    const project = basename(projectPath) || basename(this.#workspaceRoot);

    const target = `${SESSION_PREFIX}${ulid()}`;
    await newShellSession(target, cwd);
    await sendLine(target, profile.command);

    const projectId = await this.memory.ensureProject(project, cwd);
    const taskId = await this.memory.createTask(projectId, task || `spustený ${agentKind}`);
    const workerId = await this.memory.startWorker({
      projectId, projectName: project, agentKind, sessionId: target,
      tmuxTarget: target, launchCommand: profile.command, taskId,
    });
    const source = new SnapshotCaptureSource(target, { pollMs: 1200 });
    this.#tracked.set(target, { workerId, projectId, projectName: project, source, lastVisible: "", stable: 0 });
    this.#log(`spawned ${agentKind} for ${project} in ${target}`);
    void this.#ingest(source, { workerId, projectId, projectName: project });
    // Give the agent a moment to reach its prompt, then hand it the task.
    if (task) setTimeout(() => void sendLine(target, task), 2500);
    return { ok: true, cwd };
  }

  async #ingest(
    source: CaptureSource,
    ctx: { workerId: string; projectId: string; projectName: string },
  ): Promise<void> {
    for await (const line of source.lines()) {
      await this.memory.ingestLine(line, ctx).catch(() => {});
    }
  }
}
