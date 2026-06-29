/**
 * WebSocket protocol between the mobile voice client and the Desktop Agent.
 * JSON over a single connection. See docs/PROTOCOL.md.
 */

import type { CatoEvent, CommandTarget } from "./events.js";

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
  | Envelope<
      "voice.command",
      { audio?: string; text?: string; locale: string; target?: CommandTarget }
    >
  | Envelope<"voice.cancel", Record<string, never>>
  | Envelope<"control.action", { action: ControlAction; target?: CommandTarget }>
  | Envelope<"subscribe", { streams: string[] }>
  | Envelope<"ping", Record<string, never>>;

// ---- Server -> Client -------------------------------------------------------

export interface ProjectStatus {
  name: string;
  /** Coarse state surfaced to the user. */
  state: "idle" | "active" | "waiting" | "attention";
  summary: string;
}

export type ServerMessage =
  | Envelope<
      "welcome",
      { sessionId: string; serverVersion: string; projects: ProjectStatus[] }
    >
  | Envelope<"transcript.partial", { text: string }>
  | Envelope<"transcript.final", { text: string; locale: string }>
  | Envelope<"speech.say", { text: string; locale: string; audio?: string }>
  | Envelope<"status.update", { projects: ProjectStatus[] }>
  | Envelope<"event.push", { event: CatoEvent }>
  | Envelope<"error", { code: string; message: string }>
  | Envelope<"pong", Record<string, never>>;

export type AnyMessage = ClientMessage | ServerMessage;
