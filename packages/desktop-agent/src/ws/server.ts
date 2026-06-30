/**
 * WebSocket server — the mobile <-> desktop transport (docs/PROTOCOL.md).
 * Phase 0/2 skeleton: handshake (`hello`/`welcome`), heartbeat, and an echo of the
 * recognized command. Real routing through the Orchestrator lands in Phase 2.
 */

import { WebSocketServer, type WebSocket } from "ws";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { ulid } from "ulid";
import { friendlyHost } from "../util/host.js";
import { machineId } from "../util/machine-id.js";
import { writeFile, unlink } from "node:fs/promises";
import { readdirSync, mkdirSync, existsSync } from "node:fs";
import { CONFIG_FILE } from "../config.js";
import { tmpdir } from "node:os";
import { join, basename, resolve, sep } from "node:path";
import {
  PROTOCOL_VERSION,
  openHandshake,
  encrypt,
  decrypt,
  type CatoEvent,
  type ApprovalRequest,
  type AgentQuestion,
  type ClientMessage,
  type ServerMessage,
} from "@cato/shared";
import { agentKeys } from "../util/keys.js";
import { hookSecret } from "../util/hook-secret.js";
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
  #authFails = new Map<string, { n: number; until: number }>(); // per-IP token-attempt lockout
  #sessionKeys = new Map<WebSocket, string>(); // per-socket E2E session key (encrypted sockets)
  // Tool-call approvals (from agents' PreToolUse gates) awaiting a human decision.
  readonly #approvals = new ApprovalManager((a) => this.#broadcastApproval(a));
  // Conversational questions an agent is waiting on (answered via question.answer).
  #onQuestionAnswer: (id: string, optionIndex: number) => void = () => {};

  /** Wire how an answered question is delivered back to the agent (AgentManager). */
  setQuestionResolver(fn: (id: string, optionIndex: number) => void): void {
    this.#onQuestionAnswer = fn;
  }

  #onSpawn: (agentKind: string, path: string, task?: string) => void = () => {};

  /** Wire how a structured spawn (from the app's folder picker) launches an agent. */
  setSpawnHandler(fn: (agentKind: string, path: string, task?: string) => void): void {
    this.#onSpawn = fn;
  }

  /** Push a pending conversational question to all paired phones. */
  pushQuestion(question: AgentQuestion): void {
    this.#broadcast(frame("agent.question", { question }));
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
    const wss = new WebSocketServer({ server: http, maxPayload: 8 * 1024 * 1024 });
    this.#wss = wss;

    wss.on("connection", (socket, req) => this.#onConnection(socket, req));
    http.listen(this.config.wsPort, this.config.wsHost, () => {
      console.log(
        `[ws] listening on ws://${this.config.wsHost}:${this.config.wsPort}/v${PROTOCOL_VERSION}` +
          ` (+ approval hook POST /hooks/pretooluse)`,
      );
    });

    // Proactive push: notable events from the bus go to all paired phones unprompted.
    this.bus.onAny((event) => this.#pushEvent(event));
  }

  /** Secured = the user ran `cato setup` and a real pairing token replaced the default.
   *  Until then, privileged endpoints are disabled (only /info is public). */
  get #secured(): boolean {
    return this.config.pairingToken !== "changeme" && this.config.pairingToken.length >= 6;
  }

  /** Authorize an HTTP request by the pairing token (header or ?token=). */
  #authedHttp(req: IncomingMessage, url: URL): boolean {
    if (!this.#secured) return false;
    const tok = req.headers["x-cato-token"] ?? url.searchParams.get("token") ?? "";
    return tok === this.config.pairingToken;
  }

  /** Resolve a relative path under the workspace root, refusing any escape (../). */
  #resolveInWorkspace(rel: string): string | null {
    const root = resolve(this.config.workspaceRoot);
    const target = resolve(root, rel || ".");
    if (target !== root && !target.startsWith(root + sep)) return null;
    return target;
  }

  /** HTTP endpoints: GET /info · GET/POST /folders (browse + create) · PreToolUse hook. */
  #onHttp(req: IncomingMessage, res: ServerResponse): void {
    // Clean UTF-8 machine name over HTTP — reliable where mDNS TXT mojibakes it.
    if (req.method === "GET" && (req.url === "/info" || req.url === "/v1/info")) {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" }).end(
        JSON.stringify({
          id: machineId(), host: friendlyHost(), platform: process.platform, version: SERVER_VERSION,
          onboarded: existsSync(CONFIG_FILE), secured: this.#secured, pub: agentKeys().publicKey,
        }),
      );
      return;
    }
    const url = new URL(req.url ?? "/", "http://localhost");
    // Browse folders under the workspace root (nested) → the "start an agent" picker.
    if (req.method === "GET" && url.pathname === "/folders") {
      if (!this.#authedHttp(req, url)) { res.writeHead(403).end(JSON.stringify({ error: "unauthorized" })); return; }
      const rel = url.searchParams.get("path") ?? "";
      const dir = this.#resolveInWorkspace(rel);
      let dirs: string[] = [];
      if (dir) {
        try {
          dirs = readdirSync(dir, { withFileTypes: true })
            .filter((d) => d.isDirectory() && !d.name.startsWith("."))
            .map((d) => d.name)
            .sort();
        } catch {
          /* unreadable → empty */
        }
      }
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" }).end(
        JSON.stringify({ root: this.config.workspaceRoot, path: rel, dirs }),
      );
      return;
    }

    const isHook = req.method === "POST" && url.pathname === "/hooks/pretooluse";
    const isMkdir = req.method === "POST" && url.pathname === "/folders";
    if (!isHook && !isMkdir) {
      res.writeHead(404).end();
      return;
    }
    // The PreToolUse hook is the local agent (Claude) asking permission — it must come
    // from this machine AND carry the per-run hook secret (so other local processes can't
    // inject fake approvals).
    if (isHook) {
      if (!isLoopback(req.socket.remoteAddress ?? "")) { res.writeHead(403).end(); return; }
      if (url.searchParams.get("s") !== hookSecret()) { res.writeHead(403).end(); return; }
    }
    // Cap the request body so an unauthenticated caller can't exhaust memory.
    let body = "";
    let tooBig = false;
    req.on("data", (c) => {
      body += c;
      if (body.length > 8 * 1024 * 1024) { tooBig = true; req.destroy(); }
    });
    req.on("end", async () => {
      if (tooBig) { try { res.writeHead(413).end(); } catch { /* already destroyed */ } return; }
      // Create a folder under the workspace root (sandboxed).
      if (isMkdir) {
        if (!this.#authedHttp(req, url)) { res.writeHead(403).end(JSON.stringify({ error: "unauthorized" })); return; }
        try {
          const { path } = JSON.parse(body || "{}") as { path?: string };
          const dir = this.#resolveInWorkspace(path ?? "");
          if (!dir || !path) return res.writeHead(400).end(JSON.stringify({ ok: false }));
          mkdirSync(dir, { recursive: true });
          res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, path }));
        } catch {
          res.writeHead(500).end(JSON.stringify({ ok: false }));
        }
        return;
      }
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

  /** Send one frame to one socket, encrypting it if that socket negotiated an E2E session. */
  #emit(socket: WebSocket, msg: ServerMessage): void {
    const key = this.#sessionKeys.get(socket);
    send(socket, key ? frame("enc", { enc: encrypt(msg, key) }) : msg);
  }

  #broadcast(msg: ServerMessage): void {
    for (const socket of this.#authed) this.#emit(socket, msg);
  }

  #broadcastApproval(approval: ApprovalRequest): void {
    this.#broadcast(frame("approval.request", { approval }));
  }

  /** Background: LLM-parse an approval and broadcast the enrichment as an update. */
  async #enrichApproval(approval: ApprovalRequest, tool: string, detail: string, risk: string): Promise<void> {
    const exp = await this.llm!.explainApproval(tool, detail, risk, DEFAULT_LOCALE).catch(() => null);
    if (!exp || (!exp.summary && !exp.suggestions.length)) return;
    if (exp.summary) approval.summary = exp.summary; // also enriches welcome-replay
    if (exp.suggestions.length) approval.suggestions = exp.suggestions;
    this.#broadcast(frame("approval.update", { id: approval.id, summary: approval.summary, suggestions: approval.suggestions }));
  }

  #pushEvent(event: CatoEvent): void {
    if (event.importance < PUSH_THRESHOLD) return;
    this.#broadcast(frame("event.push", { event }));
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.#wss?.close(() => resolve()));
    await new Promise<void>((resolve) => this.#http?.close(() => resolve()));
  }

  #onConnection(socket: WebSocket, req?: IncomingMessage): void {
    let authenticated = false;
    const ip = req?.socket.remoteAddress ?? "?";
    socket.on("close", () => { this.#authed.delete(socket); this.#sessionKeys.delete(socket); });

    const finishAuth = (replyTo: string, sessionKey?: string): void => {
      this.#authFails.delete(ip);
      authenticated = true;
      this.#authed.add(socket);
      if (sessionKey) this.#sessionKeys.set(socket, sessionKey);
      this.#emit(socket, frame(
        "welcome",
        { sessionId: ulid(), serverVersion: SERVER_VERSION, projects: [], host: friendlyHost(), platform: process.platform, machineId: machineId() },
        replyTo,
      ));
      for (const approval of this.#approvals.list()) this.#emit(socket, frame("approval.request", { approval }));
      void this.#pushInitialStatus(socket);
    };
    // Evaluate the token FIRST: a correct token always gets in (and clears any lockout);
    // a wrong one is rate-limited. So an attacker on the same NAT can't lock out the owner.
    const tryAuth = (tokenOk: boolean, replyTo: string, sessionKey?: string): void => {
      if (!this.#secured) {
        send(socket, frame("error", { code: "not_set_up", message: "Run 'cato setup' on the desktop to secure it" }));
        socket.close();
        return;
      }
      if (tokenOk) return finishAuth(replyTo, sessionKey);
      const rec = this.#authFails.get(ip);
      if (rec && rec.until > Date.now()) {
        send(socket, frame("error", { code: "rate_limited", message: "too many attempts, try again shortly" }));
        socket.close();
        return;
      }
      const n = (rec?.n ?? 0) + 1;
      this.#authFails.set(ip, { n, until: n >= 5 ? Date.now() + 30_000 : 0 });
      send(socket, frame("error", { code: "unauthorized", message: "bad token" }));
      socket.close();
    };

    const handle = (msg: ClientMessage): void => {
      switch (msg.type) {
        case "hello": {
          // Plaintext hello is only allowed on loopback (e.g. the local dashboard). Any
          // network client MUST use the encrypted secure.hello — so the token is never on
          // the wire and traffic is always E2E.
          if (!isLoopback(ip)) {
            send(socket, frame("error", { code: "encryption_required", message: "use secure.hello (E2E) — plaintext is loopback-only" }));
            socket.close();
            return;
          }
          tryAuth(msg.payload.token === this.config.pairingToken, msg.id);
          return;
        }
        case "secure.hello": {
          const opened = openHandshake<{ token: string }>(msg.payload.sealed, agentKeys().secretKey);
          tryAuth(!!opened && opened.payload.token === this.config.pairingToken, msg.id, opened?.sessionKey);
          return;
        }
        case "ping":
          this.#emit(socket, frame("pong", {}, msg.id));
          return;
        case "approval.resolve":
          if (authenticated) this.#approvals.resolve(msg.payload.id, msg.payload.decision, msg.payload.reason, msg.payload.scope);
          return;
        case "question.answer":
          if (authenticated) this.#onQuestionAnswer(msg.payload.id, msg.payload.optionIndex);
          return;
        case "worker.spawn":
          if (authenticated) this.#onSpawn(msg.payload.agentKind, msg.payload.path, msg.payload.task);
          return;
        case "terminal.get":
          if (authenticated) void this.orchestrator.terminalScreen(msg.payload.project, msg.payload.cols, msg.payload.rows).then((text) => this.#emit(socket, frame("terminal.screen", { project: msg.payload.project, text })));
          return;
        case "terminal.input":
          if (authenticated) void this.orchestrator.terminalInput(msg.payload.project, msg.payload.text);
          return;
        case "terminal.key":
          if (authenticated) void this.orchestrator.terminalKey(msg.payload.project, msg.payload.key);
          return;
        case "terminal.release":
          if (authenticated) void this.orchestrator.terminalRelease(msg.payload.project);
          return;
        default:
          if (!authenticated) { send(socket, frame("error", { code: "unauthorized", message: "say hello first" })); return; }
          void this.#route(socket, msg);
          return;
      }
    };

    socket.on("message", (raw) => {
      let outer: ClientMessage;
      try {
        outer = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        return send(socket, frame("error", { code: "bad_json", message: "invalid frame" }));
      }
      // Encrypted envelope → decrypt to the real message with this socket's session key.
      if (outer.type === "enc") {
        const key = this.#sessionKeys.get(socket);
        const inner = key ? decrypt<ClientMessage>(outer.payload.enc, key) : null;
        if (!inner) { send(socket, frame("error", { code: "bad_enc", message: "no session / bad frame" })); return; }
        return handle(inner);
      }
      handle(outer);
    });
  }

  async #pushInitialStatus(socket: WebSocket): Promise<void> {
    const projects = await this.orchestrator.statuses().catch(() => []);
    if (projects.length) this.#emit(socket, frame("status.update", { projects }));
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
        this.#emit(socket, frame("transcript.final", { text, locale }, msg.id));
        const reply = await this.orchestrator.handleCommand(text, locale, msg.payload.target);
        if (reply.statuses) this.#emit(socket, frame("status.update", { projects: reply.statuses }));
        this.#emit(socket, frame("speech.say", { text: reply.speak, locale: reply.locale }, msg.id));
        return;
      }

      if (msg.type === "control.action") {
        const reply = await this.orchestrator.handleControl(
          msg.payload.action,
          msg.payload.locale || DEFAULT_LOCALE,
          msg.payload.target,
        );
        if (reply.statuses) this.#emit(socket, frame("status.update", { projects: reply.statuses }));
        this.#emit(socket, frame("speech.say", { text: reply.speak, locale: reply.locale }, msg.id));
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

/** True for loopback peers (the local dashboard / the PreToolUse hook). */
function isLoopback(remote: string): boolean {
  return remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1" || remote.endsWith(":127.0.0.1");
}
