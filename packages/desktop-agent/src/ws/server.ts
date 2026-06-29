/**
 * WebSocket server — the mobile <-> desktop transport (docs/PROTOCOL.md).
 * Phase 0/2 skeleton: handshake (`hello`/`welcome`), heartbeat, and an echo of the
 * recognized command. Real routing through the Orchestrator lands in Phase 2.
 */

import { WebSocketServer, type WebSocket } from "ws";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { ulid } from "ulid";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import {
  PROTOCOL_VERSION,
  type CatoEvent,
  type ApprovalRequest,
  type AgentQuestion,
  type ClientMessage,
  type ServerMessage,
} from "@cato/shared";
import type { Config } from "../config.js";
import type { EventBus } from "../bus/event-bus.js";
import type { Orchestrator } from "../orchestrator/orchestrator.js";
import type { Stt } from "../voice/stt.js";
import type { Llm } from "../voice/llm.js";
import { toWav16kMono } from "../voice/convert.js";
import { ApprovalManager, summarizeToolCall, ruleKey } from "../approvals/manager.js";

const SERVER_VERSION = "0.0.0";
const DEFAULT_LOCALE = "sk";
/** Only push events at least this important to phones (avoid noise). */
const PUSH_THRESHOLD = 0.6;

export class WsServer {
  #wss: WebSocketServer | undefined;
  #http: Server | undefined;
  #authed = new Set<WebSocket>();
  // Tool-call approvals (from agents' PreToolUse gates) awaiting a human decision.
  readonly #approvals = new ApprovalManager((a) => this.#broadcastApproval(a));
  // Conversational questions an agent is waiting on (answered via question.answer).
  #onQuestionAnswer: (id: string, optionIndex: number) => void = () => {};

  /** Wire how an answered question is delivered back to the agent (AgentManager). */
  setQuestionResolver(fn: (id: string, optionIndex: number) => void): void {
    this.#onQuestionAnswer = fn;
  }

  /** Push a pending conversational question to all paired phones. */
  pushQuestion(question: AgentQuestion): void {
    const f = frame("agent.question", { question });
    for (const socket of this.#authed) send(socket, f);
  }

  constructor(
    private readonly config: Config,
    private readonly bus: EventBus,
    private readonly orchestrator: Orchestrator,
    private readonly stt?: Stt,
    private readonly llm?: Llm,
  ) {}

  /** Run local STT on base64 audio (ANY format) → text. ffmpeg normalizes to 16 kHz
   *  mono WAV first, so the phone can record in its native format. */
  async #transcribe(audioB64: string, locale: string): Promise<string> {
    if (!this.stt) throw new Error("STT not available (no whisper model)");
    const inPath = join(tmpdir(), `cato-${ulid()}.audio`);
    await writeFile(inPath, Buffer.from(audioB64, "base64"));
    let wavPath: string | undefined;
    try {
      wavPath = await toWav16kMono(inPath, this.config.ffmpegBin);
      return await this.stt.transcribe(wavPath, locale);
    } finally {
      await unlink(inPath).catch(() => {});
      if (wavPath) await unlink(wavPath).catch(() => {});
    }
  }

  start(): void {
    // One HTTP server hosts both the WebSocket (phones) and the PreToolUse hook
    // endpoint (agents POST tool-call approvals here).
    const http = createServer((req, res) => this.#onHttp(req, res));
    this.#http = http;
    const wss = new WebSocketServer({ server: http });
    this.#wss = wss;

    wss.on("connection", (socket) => this.#onConnection(socket));
    http.listen(this.config.wsPort, this.config.wsHost, () => {
      console.log(
        `[ws] listening on ws://${this.config.wsHost}:${this.config.wsPort}/v${PROTOCOL_VERSION}` +
          ` (+ approval hook POST /hooks/pretooluse)`,
      );
    });

    // Proactive push: notable events from the bus go to all paired phones unprompted.
    this.bus.onAny((event) => this.#pushEvent(event));
  }

  /** PreToolUse hook endpoint: an agent asks "may I run this tool?" → ask the human. */
  #onHttp(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== "POST" || req.url !== "/hooks/pretooluse") {
      res.writeHead(404).end();
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const p = JSON.parse(body || "{}") as {
          tool_name?: string;
          tool_input?: Record<string, unknown>;
          cwd?: string;
          session_id?: string;
        };
        const tool = p.tool_name ?? "Tool";
        const { title, detail, risk, stats } = summarizeToolCall(tool, p.tool_input ?? {}, p.cwd);

        // Anti-fatigue: if a standing allow-rule covers this, approve without asking.
        const key = ruleKey(tool, title, detail);
        const session = p.session_id || p.cwd || "global";
        if (this.#approvals.isAutoAllowed(key, session)) {
          res.writeHead(200, { "content-type": "application/json" }).end(
            JSON.stringify({
              hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: "auto (Cato rule)" },
            }),
          );
          return;
        }

        const approval: ApprovalRequest = {
          id: ulid(),
          project: p.cwd ? basename(p.cwd) : undefined,
          tool,
          title,
          risk,
          stats,
          detail,
          ts: new Date().toISOString(),
        };
        // Push the card NOW; let the LLM parse a plain-language summary + quick replies
        // in the background and send an approval.update when ready (no push-path latency).
        const decisionP = this.#approvals.request(approval, key, session);
        if (this.llm) void this.#enrichApproval(approval, tool, detail, risk);
        const decision = await decisionP;
        res.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: decision.decision,
              permissionDecisionReason:
                decision.reason ?? (decision.decision === "deny" ? "Denied via Cato" : ""),
            },
          }),
        );
      } catch {
        res.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask" } }),
        );
      }
    });
  }

  #broadcastApproval(approval: ApprovalRequest): void {
    const f = frame("approval.request", { approval });
    for (const socket of this.#authed) send(socket, f);
  }

  /** Background: LLM-parse an approval and broadcast the enrichment as an update. */
  async #enrichApproval(approval: ApprovalRequest, tool: string, detail: string, risk: string): Promise<void> {
    const exp = await this.llm!.explainApproval(tool, detail, risk, DEFAULT_LOCALE).catch(() => null);
    if (!exp || (!exp.summary && !exp.suggestions.length)) return;
    if (exp.summary) approval.summary = exp.summary; // also enriches welcome-replay
    if (exp.suggestions.length) approval.suggestions = exp.suggestions;
    const f = frame("approval.update", { id: approval.id, summary: approval.summary, suggestions: approval.suggestions });
    for (const socket of this.#authed) send(socket, f);
  }

  #pushEvent(event: CatoEvent): void {
    if (event.importance < PUSH_THRESHOLD) return;
    const f = frame("event.push", { event });
    for (const socket of this.#authed) send(socket, f);
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.#wss?.close(() => resolve()));
    await new Promise<void>((resolve) => this.#http?.close(() => resolve()));
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
          // Replay any approvals still waiting, so a just-opened phone sees them.
          for (const approval of this.#approvals.list()) {
            send(socket, frame("approval.request", { approval }));
          }
          return;
        }

        case "ping":
          return send(socket, frame("pong", {}, msg.id));

        case "approval.resolve": {
          if (!authenticated) return;
          this.#approvals.resolve(msg.payload.id, msg.payload.decision, msg.payload.reason, msg.payload.scope);
          return;
        }

        case "question.answer": {
          if (!authenticated) return;
          this.#onQuestionAnswer(msg.payload.id, msg.payload.optionIndex);
          return;
        }

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
          msg.payload.locale || DEFAULT_LOCALE,
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
