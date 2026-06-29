/**
 * Agent abstraction — Cato must never depend directly on Claude Code.
 * Every coding agent implements this interface. See docs/ARCHITECTURE.md §4.
 */

export type WorkerState = "starting" | "running" | "stopped" | "crashed";

export interface AgentSession {
  /** Adapter-native session id. */
  id: string;
  /** Adapter type, e.g. "claude-code". */
  kind: string;
  /** Project/workspace name this session belongs to, if known. */
  project?: string;
  /** tmux pane / target reference, if applicable. */
  tmuxTarget?: string;
  state: WorkerState;
}

/** A single turn/message in a worker session transcript. */
export interface TranscriptEntry {
  role: "user" | "assistant" | "system" | "tool";
  text: string;
  ts?: string;
}

export interface SessionTranscript {
  sessionId: string;
  entries: TranscriptEntry[];
}

/** Low-level event streamed from a single worker session. */
export interface AgentEvent {
  sessionId: string;
  kind: "output" | "state" | "exit";
  text?: string;
  state?: WorkerState;
  ts: string;
}

/** Enough state to resume a task on a fresh worker. */
export interface TaskCheckpoint {
  taskId: string;
  state: unknown;
  createdAt: string;
}

export interface CodingAgent {
  /** Stable id of the adapter type, e.g. "claude-code". */
  readonly kind: string;

  /** List sessions this agent currently has (running or resumable). */
  listSessions(): Promise<AgentSession[]>;

  /** Read a session's transcript / state. */
  readSession(sessionId: string): Promise<SessionTranscript>;

  /** Inject a message/command into a running session. */
  sendMessage(sessionId: string, text: string): Promise<void>;

  /** Restart a dead/stuck session, restoring the given checkpoint if any. */
  restart(sessionId: string, checkpoint?: TaskCheckpoint): Promise<AgentSession>;

  /** Stream events (output, state changes) as they happen. */
  watchEvents(sessionId: string): AsyncIterable<AgentEvent>;
}
