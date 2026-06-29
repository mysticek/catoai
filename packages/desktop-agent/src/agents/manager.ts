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

import { join } from "node:path";
import { existsSync } from "node:fs";
import { ulid } from "ulid";
import type { MemoryEngine } from "../memory/memory-engine.js";
import { SnapshotCaptureSource } from "../capture/snapshot.js";
import type { CaptureSource } from "../capture/source.js";
import { PROFILES } from "./profiles.js";
import {
  listAllSessions, capturePaneHistory, newShellSession, sendLine, SESSION_PREFIX,
} from "../tmux/tmux.js";

interface Tracked {
  workerId: string;
  projectId: string;
  projectName: string;
  source: CaptureSource;
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
  onLog?: (msg: string) => void;
}

export class AgentManager {
  #tracked = new Map<string, Tracked>(); // key: tmux session name
  #timer: ReturnType<typeof setInterval> | undefined;
  #busy = false;
  readonly #discoverMs: number;
  readonly #workspaceRoot: string;
  readonly #log: (m: string) => void;

  constructor(
    private readonly memory: MemoryEngine,
    opts: AgentManagerOptions = {},
  ) {
    this.#discoverMs = opts.discoverMs ?? 2500;
    this.#workspaceRoot = opts.workspaceRoot ?? process.cwd();
    this.#log = opts.onLog ?? (() => {});
  }

  start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => void this.#discover(), this.#discoverMs);
    void this.#discover();
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
      const adoptable = all.filter((s) => !s.startsWith(SESSION_PREFIX));
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
    const projectName = session.slice(0, 40) || session;
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
    this.#tracked.set(session, { workerId, projectId, projectName, source });
    this.#log(`adopted ${session} (project=${projectName})`);
    void this.#ingest(source, { workerId, projectId, projectName });
  }

  /**
   * Voice-spawn a worker for a project: locate the project folder under the
   * workspace root, launch the agent in a fresh tmux session, capture it, and
   * register it (with launch_command, so recovery can resurrect it).
   */
  async spawnForProject(agentKind: string, project: string): Promise<SpawnResult> {
    const profile = PROFILES[agentKind];
    if (!profile) return { ok: false, reason: `nepoznám agenta ${agentKind}` };
    const cwd = join(this.#workspaceRoot, project);
    if (!existsSync(cwd)) return { ok: false, reason: `nenašiel som priečinok projektu ${project}` };

    const target = `${SESSION_PREFIX}${ulid()}`;
    await newShellSession(target, cwd);
    await sendLine(target, profile.command);

    const projectId = await this.memory.ensureProject(project, cwd);
    const taskId = await this.memory.createTask(projectId, `spustený ${agentKind}`);
    const workerId = await this.memory.startWorker({
      projectId, projectName: project, agentKind, sessionId: target,
      tmuxTarget: target, launchCommand: profile.command, taskId,
    });
    const source = new SnapshotCaptureSource(target, { pollMs: 1200 });
    this.#tracked.set(target, { workerId, projectId, projectName: project, source });
    this.#log(`spawned ${agentKind} for ${project} in ${target}`);
    void this.#ingest(source, { workerId, projectId, projectName: project });
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
