/**
 * Cato protocol types — kept self-contained so the dashboard is a standalone client
 * (same convention as packages/mobile/src/catoClient.ts). These mirror @cato/shared's
 * protocol.ts / events.ts; if the shared protocol changes, mirror it here.
 */

export const PROTOCOL_VERSION = 1 as const;

export type ProjectState = "idle" | "active" | "waiting" | "attention";

export interface ProjectStatus {
  name: string;
  state: ProjectState;
  summary: string;
}

export type RiskLevel = "low" | "medium" | "high";

/** A single line of a parsed diff for rich rendering. */
export interface DiffLine {
  kind: "ctx" | "add" | "del";
  /** Line number in the new file (or old, for deletions). */
  no?: number;
  text: string;
}

export interface ApprovalRequest {
  id: string;
  project?: string;
  /** Tool being gated: "Bash" / "Edit" / "Write" / "WebFetch". */
  tool: string;
  /** Short glanceable title, e.g. "Run command" / "Edit db.ts". */
  title: string;
  risk: RiskLevel;
  /** Short stats line, e.g. "+4 −2 · 1 file". */
  stats: string;
  /** The full command / raw diff text — fallback when `diff` is absent. */
  detail: string;
  /** ISO timestamp the approval was raised — for "4m ago". */
  ts?: string;
  /** LLM plain-language explanation of what the action does & why it matters. */
  summary?: string;
  /** LLM-suggested quick replies. */
  suggestions?: string[];
  /** Optional structured fields the desktop deep-review binds to. */
  file?: string;
  /** A one-line note on why this is risky (shown in the warning banner). */
  warning?: string;
  /** Parsed diff for the syntax-highlighted viewer. */
  diff?: DiffLine[];
  /** Working directory, shown under a command. */
  cwd?: string;
}

export interface AgentQuestion {
  id: string;
  project?: string;
  question: string;
  options: string[];
}

export type EventType =
  | "ApprovalRequested"
  | "TestsFailed"
  | "WorkerError"
  | "DeploymentStarted"
  | "DeploymentFinished"
  | "WorkerStarted"
  | "WorkerStopped"
  | "DecisionMade"
  | "TaskCreated"
  | "TaskCompleted";

export interface ActivityEvent {
  id: string;
  type: EventType | string;
  project?: string;
  title: string;
  summary: string;
  importance: number;
  ts: string;
}

export type MemoryKind = "decision" | "convention" | "context";

export interface MemoryHit {
  id: string;
  kind: MemoryKind;
  title: string;
  body: string;
  project: string;
  ts: string;
  /** 0..1 semantic relevance to the active query. */
  score: number;
}

export type WorkerLifecycleState = "active" | "crashed" | "stopped" | "created";

export interface WorkerSpan {
  id: string;
  label: string; // "Worker #2 · Claude Code"
  state: WorkerLifecycleState;
  status: string; // "Active · up 18m"
  note: string; // "Resumed task from checkpoint"
}

export interface TaskDetail {
  project: string;
  state: ProjectState;
  intentTitle: string;
  intentBody: string;
  workers: WorkerSpan[];
  /** Captured output tail — colored mono lines. */
  output: { tone: "dim" | "ok" | "warn" | "err" | "accent" | "soft"; text: string }[];
}
