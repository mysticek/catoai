/**
 * Event catalog — immutable facts that flow on the Event Bus, are persisted by the
 * Memory Engine, and (when notable) pushed to mobile. See docs/PROTOCOL.md §5 and
 * docs/MEMORY-SCHEMA.md. Current state is reconstructed from events.
 */

export type EventType =
  | "SessionStarted"
  | "WorkerStarted"
  | "WorkerStopped"
  | "VoiceCommandReceived"
  | "DecisionMade"
  | "TaskCreated"
  | "TaskCompleted"
  | "TaskCheckpoint"
  | "ApprovalRequested"
  | "TestsFailed"
  | "WorkerError"
  | "DeploymentStarted"
  | "DeploymentFinished";

/** Type-specific payloads, keyed by EventType. */
export interface EventDataMap {
  SessionStarted: { project: string; sessionId: string; agentKind: string };
  WorkerStarted: { workerId: string; sessionId: string; taskId?: string };
  WorkerStopped: { workerId: string; reason: "clean" | "crash" | "killed" };
  VoiceCommandReceived: { text: string; locale: string; target?: CommandTarget };
  DecisionMade: { taskId: string; decision: string; rationale?: string };
  TaskCreated: { taskId: string; project: string; intent: string };
  TaskCompleted: { taskId: string; result: string };
  TaskCheckpoint: { taskId: string; checkpoint: unknown };
  ApprovalRequested: { taskId: string; question: string };
  TestsFailed: { project: string; summary: string };
  WorkerError: { project: string; summary: string };
  DeploymentStarted: { project: string; target: string };
  DeploymentFinished: { project: string; target: string; status: "ok" | "failed" };
}

/** Optional addressing of a command/event to a project or worker. */
export interface CommandTarget {
  project?: string;
  workerId?: string;
}

/** A stored/transported event. `data` is narrowed by `type` via EventDataMap. */
export interface CatoEvent<T extends EventType = EventType> {
  id: string;
  type: T;
  project?: string;
  taskId?: string;
  workerId?: string;
  /** 0..1, set by importance scoring. */
  importance: number;
  ts: string; // ISO-8601 UTC
  data: EventDataMap[T];
  /** Short, voice-ready text. */
  summary?: string;
}

/** Helper to construct a well-typed event without an id/ts (assigned on append). */
export type NewCatoEvent<T extends EventType = EventType> = Omit<
  CatoEvent<T>,
  "id" | "ts"
> & { ts?: string };
