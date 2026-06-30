/**
 * CatoClient — thin WebSocket client speaking the Cato protocol (docs/PROTOCOL.md).
 * No business logic here; the desktop agent is the brain. Uses React Native's global
 * WebSocket (no `ws` package on device).
 */

import { sealHandshake, encrypt, decrypt, type Enc } from "./crypto";

const PROTOCOL_VERSION = 1 as const;

export type ProjectState = "idle" | "active" | "waiting" | "attention";

export interface ProjectStatus {
  name: string;
  state: ProjectState;
  summary: string;
}

export interface ApprovalRequest {
  id: string;
  project?: string;
  tool: string;
  title: string;
  risk: "low" | "medium" | "high";
  stats: string;
  detail: string;
  /** When the approval was raised (ISO) — for "4m ago". */
  ts?: string;
  /** LLM-parsed plain-language explanation (arrives via approval.update). */
  summary?: string;
  /** LLM-suggested quick replies (arrives via approval.update). */
  suggestions?: string[];
}

/** A conversational choice an agent is waiting on (not a tool gate). */
export interface AgentQuestion {
  id: string;
  project?: string;
  question: string;
  options: string[];
}

export interface ActivityEvent {
  type: string;
  project?: string;
  summary: string;
  importance: number;
  ts: string;
}

export type Target = { project?: string };

export interface CatoClientHandlers {
  onWelcome?: (projects: ProjectStatus[], meta: { host?: string; platform?: string; machineId?: string }) => void;
  onTranscript?: (text: string, final: boolean) => void;
  onSpeak?: (text: string, locale: string) => void;
  onStatus?: (projects: ProjectStatus[]) => void;
  onApproval?: (approval: ApprovalRequest) => void;
  onApprovalUpdate?: (id: string, summary?: string, suggestions?: string[]) => void;
  onQuestion?: (question: AgentQuestion) => void;
  onActivity?: (event: ActivityEvent) => void;
  onTerminalScreen?: (project: string, text: string) => void;
  onError?: (code: string, message: string) => void;
  onClose?: () => void;
}

let counter = 0;
const id = (): string => `m${Date.now()}_${counter++}`;

export class CatoClient {
  #ws: WebSocket | undefined;
  #sessionKey: string | undefined; // set once an E2E session is negotiated

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly handlers: CatoClientHandlers = {},
    private readonly agentPub?: string, // agent public key (from QR / /info) → E2E
  ) {}

  connect(): void {
    const ws = new WebSocket(this.url);
    this.#ws = ws;
    ws.onopen = () => {
      // Prefer an encrypted handshake when we know the agent's public key; on any crypto
      // problem fall back to plaintext (the agent still gates on the token).
      if (this.agentPub) {
        try {
          const { sealed, sessionKey } = sealHandshake(
            { token: this.token, device: "mobile", clientVersion: "0.0.0" },
            this.agentPub,
          );
          this.#sessionKey = sessionKey;
          this.#sendRaw("secure.hello", { sealed });
          return;
        } catch {
          this.#sessionKey = undefined;
        }
      }
      this.#sendRaw("hello", { token: this.token, device: "mobile", clientVersion: "0.0.0" });
    };
    ws.onclose = () => this.handlers.onClose?.();
    ws.onerror = () => this.handlers.onError?.("ws", "connection error");
    ws.onmessage = (ev) => this.#onMessage(String(ev.data));
  }

  close(): void {
    this.#ws?.close();
    this.#ws = undefined;
  }

  get connected(): boolean {
    return this.#ws?.readyState === 1;
  }

  /** Send a spoken command — either recorded audio (base64 WAV) or typed text. */
  sendVoice(input: { audioBase64?: string; text?: string; locale?: string; target?: Target }): void {
    this.#send("voice.command", {
      audio: input.audioBase64,
      text: input.text,
      locale: input.locale ?? "en",
      target: input.target,
    });
  }

  /** Explicit control button. */
  sendControl(action: "continue" | "stop" | "repeat" | "summarize", locale = "en", target?: Target): void {
    this.#send("control.action", { action, locale, target });
  }

  /** Answer a pending tool-call approval. scope: once | command | session. */
  resolveApproval(
    approvalId: string,
    decision: "allow" | "deny",
    reason?: string,
    scope: "once" | "command" | "session" = "once",
  ): void {
    this.#send("approval.resolve", { id: approvalId, decision, reason, scope });
  }

  /** Answer a conversational multi-choice question. */
  answerQuestion(questionId: string, optionIndex: number): void {
    this.#send("question.answer", { id: questionId, optionIndex });
  }

  /** Launch an agent in a workspace folder (path relative to the agent's workspace root). */
  spawnWorker(agentKind: string, path: string, task?: string): void {
    this.#send("worker.spawn", { agentKind, path, task: task || undefined });
  }

  /** Live terminal mirror: request the current screen (reflowed to cols×rows), type a line,
   *  send a raw key, or release the forced size when the viewer closes. */
  getTerminal(project: string, cols?: number, rows?: number): void {
    this.#send("terminal.get", { project, cols, rows });
  }
  terminalInput(project: string, text: string): void {
    this.#send("terminal.input", { project, text });
  }
  terminalKey(project: string, key: string): void {
    this.#send("terminal.key", { project, key });
  }
  terminalRelease(project: string): void {
    this.#send("terminal.release", { project });
  }

  /** Send a frame — encrypted (wrapped in `enc`) once an E2E session exists, else plain. */
  #send(type: string, payload: unknown): void {
    if (this.#sessionKey) {
      const inner = { v: PROTOCOL_VERSION, id: id(), type, ts: new Date().toISOString(), payload };
      this.#sendRaw("enc", { enc: encrypt(inner, this.#sessionKey) });
    } else {
      this.#sendRaw(type, payload);
    }
  }

  #sendRaw(type: string, payload: unknown): void {
    this.#ws?.send(
      JSON.stringify({ v: PROTOCOL_VERSION, id: id(), type, ts: new Date().toISOString(), payload }),
    );
  }

  #onMessage(raw: string): void {
    let msg: { type: string; payload: Record<string, unknown> };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    // Encrypted envelope → decrypt to the real message with our session key.
    if (msg.type === "enc" && this.#sessionKey) {
      const inner = decrypt<{ type: string; payload: Record<string, unknown> }>(msg.payload.enc as Enc, this.#sessionKey);
      if (inner) { this.#dispatch(inner); }
      return;
    }
    this.#dispatch(msg);
  }

  #dispatch(msg: { type: string; payload: Record<string, unknown> }): void {
    const p = msg.payload ?? {};
    switch (msg.type) {
      case "welcome":
        return this.handlers.onWelcome?.((p.projects as ProjectStatus[]) ?? [], {
          host: p.host as string | undefined,
          platform: p.platform as string | undefined,
          machineId: p.machineId as string | undefined,
        });
      case "transcript.partial":
        return this.handlers.onTranscript?.(String(p.text ?? ""), false);
      case "transcript.final":
        return this.handlers.onTranscript?.(String(p.text ?? ""), true);
      case "speech.say":
        return this.handlers.onSpeak?.(String(p.text ?? ""), String(p.locale ?? "en"));
      case "status.update":
        return this.handlers.onStatus?.((p.projects as ProjectStatus[]) ?? []);
      case "approval.request":
        return this.handlers.onApproval?.(p.approval as ApprovalRequest);
      case "approval.update":
        return this.handlers.onApprovalUpdate?.(
          String(p.id ?? ""),
          p.summary as string | undefined,
          p.suggestions as string[] | undefined,
        );
      case "agent.question":
        return this.handlers.onQuestion?.(p.question as AgentQuestion);
      case "event.push":
        return this.handlers.onActivity?.((p.event as ActivityEvent) ?? ({} as ActivityEvent));
      case "terminal.screen":
        return this.handlers.onTerminalScreen?.(String(p.project ?? ""), String(p.text ?? ""));
      case "error":
        return this.handlers.onError?.(String(p.code ?? "error"), String(p.message ?? ""));
    }
  }
}
