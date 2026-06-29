/**
 * TerminalAgent — the one CodingAgent implementation. Drives ANY terminal worker
 * via tmux + a capture file Cato owns. Agent-specific bits live in WorkerProfile.
 * See docs/ARCHITECTURE.md §4.2.
 *
 * sessionId == the worker's capture id; the tmux session is `cato_<sessionId>`.
 */

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import type {
  AgentEvent,
  AgentSession,
  CodingAgent,
  SessionTranscript,
  TaskCheckpoint,
  TranscriptEntry,
} from "@cato/shared";
import { FileTailSource } from "../capture/file-tail.js";
import { clean } from "../memory/importance.js";
import type { WorkerProfile } from "./profiles.js";
import {
  SESSION_PREFIX,
  listSessions,
  newShellSession,
  pipePaneToFile,
  sendLine,
} from "../tmux/tmux.js";

export class TerminalAgent implements CodingAgent {
  readonly kind: string;

  constructor(
    private readonly profile: WorkerProfile,
    /** Directory where Cato keeps capture logs, e.g. ~/.cato/capture. */
    private readonly captureDir: string,
  ) {
    this.kind = profile.kind;
  }

  #target(sessionId: string): string {
    return `${SESSION_PREFIX}${sessionId}`;
  }

  captureFile(sessionId: string): string {
    return join(this.captureDir, `${sessionId}.log`);
  }

  /**
   * Spawn a fresh worker: create the tmux session, start streaming its pane into
   * our capture file. Returns the session handle. (Not part of CodingAgent, used
   * by the Agent Manager / runner.)
   */
  async spawn(sessionId: string, cwd: string): Promise<AgentSession> {
    const target = this.#target(sessionId);
    // Run the worker inside a shell (not as the pane's root process) so the pane
    // survives if the worker dies — this is what makes recovery possible.
    await newShellSession(target, cwd);
    await pipePaneToFile(target, this.captureFile(sessionId)); // attach BEFORE launch
    await sendLine(target, this.profile.command);
    return { id: sessionId, kind: this.kind, project: undefined, tmuxTarget: target, state: "running" };
  }

  async listSessions(): Promise<AgentSession[]> {
    const names = await listSessions();
    return names.map((name) => ({
      id: name.slice(SESSION_PREFIX.length),
      kind: this.kind,
      tmuxTarget: name,
      state: "running" as const,
    }));
  }

  async readSession(sessionId: string): Promise<SessionTranscript> {
    let text = "";
    try {
      text = await readFile(this.captureFile(sessionId), "utf8");
    } catch {
      /* no capture yet */
    }
    const entries: TranscriptEntry[] = text
      .split("\n")
      .map((l) => clean(l))
      .filter((l) => l.trim().length > 0)
      .map((l) => ({ role: "assistant", text: l }));
    return { sessionId, entries };
  }

  async sendMessage(sessionId: string, text: string): Promise<void> {
    await sendLine(this.#target(sessionId), text);
  }

  /** Relaunch the worker in the SAME (surviving) pane and re-inject a checkpoint. */
  async restart(sessionId: string, checkpoint?: TaskCheckpoint): Promise<AgentSession> {
    const target = this.#target(sessionId);
    await sendLine(target, this.profile.command);
    if (checkpoint && typeof checkpoint.state === "string") {
      await sendLine(target, checkpoint.state);
    }
    return { id: sessionId, kind: this.kind, tmuxTarget: target, state: "running" };
  }

  async *watchEvents(sessionId: string): AsyncIterable<AgentEvent> {
    const source = new FileTailSource(this.captureFile(sessionId), { fromStart: false });
    for await (const raw of source.lines()) {
      yield {
        sessionId,
        kind: "output",
        text: clean(raw),
        ts: new Date().toISOString(),
      };
    }
  }
}
