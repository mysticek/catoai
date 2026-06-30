/**
 * WebSocket protocol between the mobile voice client and the Desktop Agent.
 * JSON over a single connection. See docs/PROTOCOL.md.
 */

import type { CatoEvent, CommandTarget } from "./events.js";
import type { Sealed, Enc } from "./crypto.js";

export const PROTOCOL_VERSION = 1 as const;

/** Common envelope for every frame. */
export interface Envelope<TType extends string, TPayload> {
  v: typeof PROTOCOL_VERSION;
  id: string; // ULID
  type: TType;
  ts: string; // ISO-8601 UTC
  /** Correlates a server reply to a client message id. */
  replyTo?: string;
  payload: TPayload;
}

// ---- Client -> Server -------------------------------------------------------

export type ControlAction = "continue" | "stop" | "repeat" | "summarize";

export type ClientMessage =
  | Envelope<"hello", { token: string; device: string; clientVersion: string }>
  // E2E handshake: seal the token to the agent's pinned public key (token never in clear).
  | Envelope<"secure.hello", { sealed: Sealed }>
  // Encrypted wrapper — `enc` decrypts to any other ClientMessage once a session exists.
  | Envelope<"enc", { enc: Enc }>
  | Envelope<
      "voice.command",
      { audio?: string; text?: string; locale: string; target?: CommandTarget }
    >
  | Envelope<"voice.cancel", Record<string, never>>
  | Envelope<"control.action", { action: ControlAction; target?: CommandTarget; locale?: string }>
  | Envelope<
      "approval.resolve",
      {
        id: string;
        decision: "allow" | "deny";
        reason?: string;
        /** "once" (default) · "command" = always allow this exact command ·
         *  "session" = allow everything from this worker session. */
        scope?: "once" | "command" | "session";
      }
    >
  | Envelope<"question.answer", { id: string; optionIndex: number }>
  | Envelope<"worker.spawn", { agentKind: string; path: string; task?: string }>
  // Live 1:1 terminal mirror (two-way): get the rendered screen (optionally reflowed to the
  // viewer's cols×rows), type a line, send a key, or release the forced size on close.
  | Envelope<"terminal.get", { project: string; cols?: number; rows?: number }>
  | Envelope<"terminal.input", { project: string; text: string }>
  | Envelope<"terminal.key", { project: string; key: string }>
  | Envelope<"terminal.release", { project: string }>
  | Envelope<"subscribe", { streams: string[] }>
  | Envelope<"status.get", Record<string, never>>
  // Close a running chat (kills its session) / list all chats incl. past ones (history).
  | Envelope<"session.close", { project: string }>
  | Envelope<"session.delete", { project: string }>
  | Envelope<"session.reopen", { project: string }>
  | Envelope<"session.openDesktop", { project: string }>
  | Envelope<"projects.list", Record<string, never>>
  | Envelope<"ping", Record<string, never>>;

/** A pending tool-call approval (from an agent's PreToolUse gate). */
export interface ApprovalRequest {
  id: string;
  project?: string;
  /** Tool being gated, e.g. "Bash" / "Edit" / "Write". */
  tool: string;
  /** Short glanceable title, e.g. "Run command" / "Edit index.ts" (basename only). */
  title: string;
  /** Heuristic risk so dangerous ops stand out at a glance. */
  risk: "low" | "medium" | "high";
  /** Short stats line, e.g. "+4 −0 · 1 file" (empty for simple commands). */
  stats: string;
  /** The full command / diff — collapsed on the card, expand to review. */
  detail: string;
  /** When the approval was raised (ISO-8601) — for "4m ago" on the card. */
  ts?: string;
  /** LLM-parsed plain-language explanation of what this does (for nice display). */
  summary?: string;
  /** LLM-suggested quick actions/replies (e.g. "Approve", "Deny: add tests too"). */
  suggestions?: string[];
}

// ---- Server -> Client -------------------------------------------------------

export interface ProjectStatus {
  name: string;
  /** Coarse state surfaced to the user. */
  state: "idle" | "active" | "waiting" | "attention";
  summary: string;
  /** The folder this chat is running in (home shortened to ~), for the project card. */
  cwd?: string;
}

export type ServerMessage =
  | Envelope<
      "welcome",
      { sessionId: string; serverVersion: string; projects: ProjectStatus[]; host?: string; platform?: string; machineId?: string }
    >
  | Envelope<"transcript.partial", { text: string }>
  | Envelope<"transcript.final", { text: string; locale: string }>
  | Envelope<"speech.say", { text: string; locale: string; audio?: string }>
  | Envelope<"status.update", { projects: ProjectStatus[] }>
  | Envelope<"event.push", { event: CatoEvent }>
  | Envelope<"approval.request", { approval: ApprovalRequest }>
  | Envelope<"approval.update", { id: string; summary?: string; suggestions?: string[] }>
  | Envelope<"agent.question", { question: AgentQuestion }>
  | Envelope<"terminal.screen", { project: string; text: string }>
  | Envelope<"projects.all", { projects: ProjectInfo[] }>
  | Envelope<"error", { code: string; message: string }>
  | Envelope<"enc", { enc: Enc }>
  | Envelope<"pong", Record<string, never>>;

/** A chat (project) for the history list — running or past. */
export interface ProjectInfo {
  name: string;
  cwd: string;
  running: boolean;
  lastActive?: string; // ISO
}

/** A conversational choice an agent is waiting on (not a tool gate). */
export interface AgentQuestion {
  id: string;
  project?: string;
  question: string;
  options: string[];
}

export type AnyMessage = ClientMessage | ServerMessage;
