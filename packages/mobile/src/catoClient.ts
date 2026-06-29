/**
 * CatoClient — thin WebSocket client speaking the Cato protocol (docs/PROTOCOL.md).
 * No business logic here; the desktop agent is the brain. Uses React Native's global
 * WebSocket (no `ws` package on device).
 */

const PROTOCOL_VERSION = 1 as const;

export interface ProjectStatus {
  name: string;
  state: "idle" | "active" | "waiting" | "attention";
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
}

export interface CatoClientHandlers {
  onWelcome?: () => void;
  onTranscript?: (text: string) => void;
  onSpeak?: (text: string, locale: string) => void;
  onStatus?: (projects: ProjectStatus[]) => void;
  onApproval?: (approval: ApprovalRequest) => void;
  onError?: (code: string, message: string) => void;
  onClose?: () => void;
}

let counter = 0;
const id = (): string => `m${Date.now()}_${counter++}`;

export class CatoClient {
  #ws: WebSocket | undefined;

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly handlers: CatoClientHandlers = {},
  ) {}

  connect(): void {
    const ws = new WebSocket(this.url);
    this.#ws = ws;
    ws.onopen = () => this.#send("hello", { token: this.token, device: "mobile", clientVersion: "0.0.0" });
    ws.onclose = () => this.handlers.onClose?.();
    ws.onerror = () => this.handlers.onError?.("ws", "connection error");
    ws.onmessage = (ev) => this.#onMessage(String(ev.data));
  }

  close(): void {
    this.#ws?.close();
    this.#ws = undefined;
  }

  /** Send a spoken command — either recorded audio (base64 WAV) or typed text. */
  sendVoice(input: { audioBase64?: string; text?: string; locale?: string }): void {
    this.#send("voice.command", {
      audio: input.audioBase64,
      text: input.text,
      locale: input.locale ?? "sk",
    });
  }

  /** Explicit control button. */
  sendControl(action: "continue" | "stop" | "repeat" | "summarize"): void {
    this.#send("control.action", { action });
  }

  /** Answer a pending tool-call approval. */
  resolveApproval(approvalId: string, decision: "allow" | "deny", reason?: string): void {
    this.#send("approval.resolve", { id: approvalId, decision, reason });
  }

  #send(type: string, payload: unknown): void {
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
    const p = msg.payload ?? {};
    switch (msg.type) {
      case "welcome":
        return this.handlers.onWelcome?.();
      case "transcript.final":
        return this.handlers.onTranscript?.(String(p.text ?? ""));
      case "speech.say":
        return this.handlers.onSpeak?.(String(p.text ?? ""), String(p.locale ?? "sk"));
      case "status.update":
        return this.handlers.onStatus?.((p.projects as ProjectStatus[]) ?? []);
      case "approval.request":
        return this.handlers.onApproval?.(p.approval as ApprovalRequest);
      case "error":
        return this.handlers.onError?.(String(p.code ?? "error"), String(p.message ?? ""));
    }
  }
}
