/**
 * RecoveryMonitor — "workers are replaceable, tasks are not" (docs/ARCHITECTURE.md §5).
 *
 * Polls each managed worker's tmux pane. If the worker process has exited but the
 * pane (shell) is still alive, Cato:
 *   1. records the crash (WorkerStopped),
 *   2. relaunches the worker command in the same pane,
 *   3. restores the project's latest checkpoint (re-injects it),
 *   4. registers the replacement worker (WorkerStarted).
 * The user ideally never notices.
 */

import type { MemoryEngine } from "../memory/memory-engine.js";
import { paneCurrentCommand, sendLine } from "../tmux/tmux.js";

const SHELLS = new Set(["zsh", "bash", "sh", "fish", "-zsh", "-bash", "dash", "ksh"]);

export interface RecoveryControl {
  send(tmuxTarget: string, text: string): Promise<void>;
}

export interface RecoveryMonitorOptions {
  pollMs?: number;
  /** Suppress re-checks of a target for this long after a recovery (anti-flap). */
  cooldownMs?: number;
  /** Don't health-check a worker until it has had this long to actually launch. */
  graceMs?: number;
  /** Called on notable transitions (for logging/tests). */
  onLog?: (msg: string) => void;
}

export class RecoveryMonitor {
  #timer: ReturnType<typeof setInterval> | undefined;
  #busy = false;
  #cooldownUntil = new Map<string, number>();
  readonly #pollMs: number;
  readonly #cooldownMs: number;
  readonly #graceMs: number;
  readonly #log: (msg: string) => void;

  constructor(
    private readonly memory: MemoryEngine,
    private readonly control: RecoveryControl = { send: sendLine },
    opts: RecoveryMonitorOptions = {},
  ) {
    this.#pollMs = opts.pollMs ?? 2000;
    this.#cooldownMs = opts.cooldownMs ?? 5000;
    this.#graceMs = opts.graceMs ?? 4000;
    this.#log = opts.onLog ?? (() => {});
  }

  start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => void this.tick(), this.#pollMs);
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  /** One health sweep over all managed workers. */
  async tick(): Promise<void> {
    if (this.#busy) return; // avoid overlapping sweeps
    this.#busy = true;
    try {
      const workers = await this.memory.runningManagedWorkers();
      const now = Date.now();
      for (const w of workers) {
        if (now < (this.#cooldownUntil.get(w.tmuxTarget) ?? 0)) continue;
        // Grace: a just-started worker may not have replaced the shell yet.
        if (now - w.startedAt.getTime() < this.#graceMs) continue;
        const cmd = await paneCurrentCommand(w.tmuxTarget);
        if (cmd === null) {
          // Pane/session is gone entirely — cannot relaunch in place.
          await this.memory.stopWorker(w.workerId, w.projectId, w.project, "crash");
          this.#log(`[recovery] ${w.project}: pane gone, marked crashed (no in-place restart)`);
          continue;
        }
        if (SHELLS.has(cmd)) {
          await this.recover(w);
        }
      }
    } finally {
      this.#busy = false;
    }
  }

  private async recover(w: {
    workerId: string;
    projectId: string;
    project: string;
    tmuxTarget: string;
    agentKind: string;
    launchCommand: string;
    taskId: string | null;
  }): Promise<void> {
    this.#cooldownUntil.set(w.tmuxTarget, Date.now() + this.#cooldownMs);
    this.#log(`[recovery] ${w.project}: worker died — restarting`);

    // 1) record the crash of Worker #1
    await this.memory.stopWorker(w.workerId, w.projectId, w.project, "crash");

    // 2) relaunch the command in the same surviving pane
    await this.control.send(w.tmuxTarget, w.launchCommand);

    // 3) restore the project's latest checkpoint (give the shell a moment to exec)
    const checkpoint = await this.memory.latestCheckpoint(w.projectId);
    if (typeof checkpoint === "string" && checkpoint.trim()) {
      await delay(400);
      await this.control.send(w.tmuxTarget, checkpoint);
      this.#log(`[recovery] ${w.project}: checkpoint restored`);
    }

    // 4) register the replacement worker (Worker #2) on the SAME task — the task
    //    is permanent, the worker is disposable.
    await this.memory.startWorker({
      projectId: w.projectId,
      projectName: w.project,
      agentKind: w.agentKind,
      tmuxTarget: w.tmuxTarget,
      launchCommand: w.launchCommand,
      taskId: w.taskId ?? undefined,
    });
    this.#log(`[recovery] ${w.project}: replacement worker running`);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
