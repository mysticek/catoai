/**
 * WebSocket server — the mobile <-> desktop transport (docs/PROTOCOL.md).
 * Phase 0/2 skeleton: handshake (`hello`/`welcome`), heartbeat, and an echo of the
 * recognized command. Real routing through the Orchestrator lands in Phase 2.
 */

import { WebSocketServer, type WebSocket } from "ws";
import { ulid } from "ulid";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PROTOCOL_VERSION,
  type CatoEvent,
  type ClientMessage,
  type ServerMessage,
} from "@cato/shared";
import type { Config } from "../config.js";
import type { EventBus } from "../bus/event-bus.js";
import type { Orchestrator } from "../orchestrator/orchestrator.js";
import type { Stt } from "../voice/stt.js";

const SERVER_VERSION = "0.0.0";
const DEFAULT_LOCALE = "sk";
/** Only push events at least this important to phones (avoid noise). */
const PUSH_THRESHOLD = 0.6;

export class WsServer {
  #wss: WebSocketServer | undefined;
  #authed = new Set<WebSocket>();

  constructor(
    private readonly config: Config,
    private readonly bus: EventBus,
    private readonly orchestrator: Orchestrator,
    private readonly stt?: Stt,
  ) {}

  /** Run local STT on base64 audio (16 kHz mono WAV) → text. */
  async #transcribe(audioB64: string, locale: string): Promise<string> {
    if (!this.stt) throw new Error("STT not available (no whisper model)");
    const path = join(tmpdir(), `cato-${ulid()}.wav`);
    await writeFile(path, Buffer.from(audioB64, "base64"));
    try {
      return await this.stt.transcribe(path, locale);
    } finally {
      await unlink(path).catch(() => {});
    }
  }

  start(): void {
    const wss = new WebSocketServer({
      host: this.config.wsHost,
      port: this.config.wsPort,
    });
    this.#wss = wss;

    wss.on("connection", (socket) => this.#onConnection(socket));
    wss.on("listening", () => {
      console.log(
        `[ws] listening on ws://${this.config.wsHost}:${this.config.wsPort}/v${PROTOCOL_VERSION}`,
      );
    });

    // Proactive push: notable events from the bus go to all paired phones unprompted.
    this.bus.onAny((event) => this.#pushEvent(event));
  }

  #pushEvent(event: CatoEvent): void {
    if (event.importance < PUSH_THRESHOLD) return;
    const f = frame("event.push", { event });
    for (const socket of this.#authed) send(socket, f);
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.#wss?.close(() => resolve()));
  }

  #onConnection(socket: WebSocket): void {
    let authenticated = false;
    socket.on("close", () => this.#authed.delete(socket));

    socket.on("message", (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        return send(socket, frame("error", { code: "bad_json", message: "invalid frame" }));
      }

      switch (msg.type) {
        case "hello": {
          if (msg.payload.token !== this.config.pairingToken) {
            send(socket, frame("error", { code: "unauthorized", message: "bad token" }));
            socket.close();
            return;
          }
          authenticated = true;
          this.#authed.add(socket);
          send(
            socket,
            frame(
              "welcome",
              { sessionId: ulid(), serverVersion: SERVER_VERSION, projects: [] },
              msg.id,
            ),
          );
          return;
        }

        case "ping":
          return send(socket, frame("pong", {}, msg.id));

        default: {
          if (!authenticated) {
            send(socket, frame("error", { code: "unauthorized", message: "say hello first" }));
            return;
          }
          void this.#route(socket, msg);
          return;
        }
      }
    });
  }

  /** Route a voice command / control action through the Orchestrator. */
  async #route(socket: WebSocket, msg: ClientMessage): Promise<void> {
    try {
      if (msg.type === "voice.command") {
        const locale = msg.payload.locale || DEFAULT_LOCALE;
        // Accept pre-transcribed text, or base64 audio we transcribe locally (whisper).
        let text = msg.payload.text;
        if (!text && msg.payload.audio) {
          if (!this.stt) {
            return send(socket, frame("error", { code: "no_stt", message: "STT unavailable (no whisper model)" }));
          }
          text = await this.#transcribe(msg.payload.audio, locale);
        }
        if (!text) {
          return send(socket, frame("error", { code: "no_input", message: "voice.command needs text or audio" }));
        }
        send(socket, frame("transcript.final", { text, locale }, msg.id));
        const reply = await this.orchestrator.handleCommand(text, locale, msg.payload.target);
        if (reply.statuses) send(socket, frame("status.update", { projects: reply.statuses }));
        send(socket, frame("speech.say", { text: reply.speak, locale: reply.locale }, msg.id));
        return;
      }

      if (msg.type === "control.action") {
        const reply = await this.orchestrator.handleControl(
          msg.payload.action,
          DEFAULT_LOCALE,
          msg.payload.target,
        );
        if (reply.statuses) send(socket, frame("status.update", { projects: reply.statuses }));
        send(socket, frame("speech.say", { text: reply.speak, locale: reply.locale }, msg.id));
        return;
      }
    } catch (err) {
      send(socket, frame("error", { code: "internal", message: (err as Error).message }));
    }
  }
}

function frame<T extends ServerMessage["type"]>(
  type: T,
  payload: Extract<ServerMessage, { type: T }>["payload"],
  replyTo?: string,
): ServerMessage {
  return {
    v: PROTOCOL_VERSION,
    id: ulid(),
    type,
    ts: new Date().toISOString(),
    ...(replyTo ? { replyTo } : {}),
    payload,
  } as ServerMessage;
}

function send(socket: WebSocket, message: ServerMessage): void {
  socket.send(JSON.stringify(message));
}
