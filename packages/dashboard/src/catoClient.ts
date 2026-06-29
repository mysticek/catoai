/**
 * CatoClient — browser WebSocket client speaking the Cato protocol (docs/PROTOCOL.md).
 * The desktop agent is the brain; this is a thin transport with auto-reconnect.
 * Mirrors packages/mobile/src/catoClient.ts, adapted for the dashboard's needs.
 */

import {
  PROTOCOL_VERSION,
  type ProjectStatus,
  type ApprovalRequest,
  type AgentQuestion,
  type ActivityEvent,
} from "./types";

export type ConnState = "connecting" | "connected" | "offline";

export interface CatoClientHandlers {
  onConnState?: (state: ConnState) => void;
  onWelcome?: (projects: ProjectStatus[], meta: { host?: string; platform?: string }) => void;
  onStatus?: (projects: ProjectStatus[]) => void;
  onApproval?: (approval: ApprovalRequest) => void;
  onApprovalUpdate?: (id: string, summary?: string, suggestions?: string[]) => void;
  onApprovalResolved?: (id: string) => void;
  onQuestion?: (question: AgentQuestion) => void;
  onActivity?: (event: ActivityEvent) => void;
  onError?: (code: string, message: string) => void;
}

type Decision = "allow" | "deny";
type Scope = "once" | "command" | "session";

const newId = (): string => Math.random().toString(36).slice(2) + Date.now().toString(36);

/** Default agent endpoint — the URL shown in the design (localhost:7842). */
export function defaultUrl(): string {
  const override = typeof localStorage !== "undefined" ? localStorage.getItem("cato.ws") : null;
  if (override) return override;
  const host = typeof location !== "undefined" ? location.hostname || "localhost" : "localhost";
  return `ws://${host}:7842`;
}

export class CatoClient {
  #ws: WebSocket | undefined;
  #url: string;
  #handlers: CatoClientHandlers;
  #token: string;
  #retry = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #closed = false;

  constructor(handlers: CatoClientHandlers, url = defaultUrl()) {
    this.#handlers = handlers;
    this.#url = url;
    this.#token =
      (typeof localStorage !== "undefined" && localStorage.getItem("cato.token")) || "dashboard";
  }

  get connected(): boolean {
    return this.#ws?.readyState === WebSocket.OPEN;
  }

  connect(): void {
    this.#closed = false;
    this.#open();
  }

  #open(): void {
    this.#handlers.onConnState?.("connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.#url);
    } catch {
      this.#scheduleReconnect();
      return;
    }
    this.#ws = ws;

    ws.onopen = () => {
      this.#retry = 0;
      this.#send("hello", { token: this.#token, device: "dashboard", clientVersion: "0.0.0" });
      this.#send("subscribe", { streams: ["status", "approvals", "events", "questions"] });
    };
    ws.onmessage = (ev) => this.#onMessage(ev.data);
    ws.onerror = () => this.#handlers.onError?.("ws", "connection error");
    ws.onclose = () => {
      this.#handlers.onConnState?.("offline");
      if (!this.#closed) this.#scheduleReconnect();
    };
  }

  #scheduleReconnect(): void {
    if (this.#closed) return;
    this.#retry = Math.min(this.#retry + 1, 6);
    const delay = Math.min(1000 * 2 ** (this.#retry - 1), 15000);
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.#open(), delay);
  }

  #onMessage(raw: unknown): void {
    if (typeof raw !== "string") return;
    let msg: { type?: string; payload?: Record<string, unknown> };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const h = this.#handlers;
    const p = msg.payload ?? {};
    switch (msg.type) {
      case "welcome":
        h.onConnState?.("connected");
        h.onWelcome?.(
          (p.projects as ProjectStatus[]) ?? [],
          { host: p.host as string | undefined, platform: p.platform as string | undefined },
        );
        break;
      case "status.update":
        h.onStatus?.((p.projects as ProjectStatus[]) ?? []);
        break;
      case "approval.request":
        if (p.approval) h.onApproval?.(p.approval as ApprovalRequest);
        break;
      case "approval.update":
        h.onApprovalUpdate?.(p.id as string, p.summary as string | undefined, p.suggestions as string[] | undefined);
        break;
      case "approval.resolved":
        h.onApprovalResolved?.(p.id as string);
        break;
      case "agent.question":
        if (p.question) h.onQuestion?.(p.question as AgentQuestion);
        break;
      case "event.push": {
        const e = p.event as Record<string, unknown> | undefined;
        if (e) {
          h.onActivity?.({
            id: (e.id as string) ?? newId(),
            type: (e.type as string) ?? "Event",
            project: e.project as string | undefined,
            title: humanizeType((e.type as string) ?? "Event"),
            summary: (e.summary as string) ?? "",
            importance: (e.importance as number) ?? 0.5,
            ts: (e.ts as string) ?? new Date().toISOString(),
          });
        }
        break;
      }
      case "error":
        h.onError?.((p.code as string) ?? "error", (p.message as string) ?? "");
        break;
    }
  }

  // ---- actions --------------------------------------------------------------

  resolveApproval(id: string, decision: Decision, opts: { reason?: string; scope?: Scope } = {}): void {
    this.#send("approval.resolve", { id, decision, reason: opts.reason, scope: opts.scope ?? "once" });
  }

  control(action: "continue" | "stop" | "repeat" | "summarize", project?: string): void {
    this.#send("control.action", { action, target: project ? { project } : undefined });
  }

  /** Best-effort "start an agent" — sent as a natural-language command (the orchestrator parses it). */
  startAgent(project: string, intent: string): void {
    this.#send("voice.command", {
      text: `Start an agent on ${project}${intent ? ` to ${intent}` : ""}`,
      locale: "en",
      target: { project },
    });
  }

  answerQuestion(id: string, optionIndex: number): void {
    this.#send("question.answer", { id, optionIndex });
  }

  close(): void {
    this.#closed = true;
    clearTimeout(this.#timer);
    this.#ws?.close();
  }

  #send(type: string, payload: unknown): void {
    if (this.#ws?.readyState !== WebSocket.OPEN) return;
    this.#ws.send(
      JSON.stringify({ v: PROTOCOL_VERSION, id: newId(), type, ts: new Date().toISOString(), payload }),
    );
  }
}

function humanizeType(t: string): string {
  const map: Record<string, string> = {
    ApprovalRequested: "Approval requested",
    TestsFailed: "Tests failed",
    WorkerError: "Worker error → recovered",
    DeploymentStarted: "Deployment started",
    DeploymentFinished: "Deployment finished",
    WorkerStarted: "Worker started",
    WorkerStopped: "Worker stopped",
    DecisionMade: "Decision made",
    TaskCreated: "Task created",
    TaskCompleted: "Task completed",
  };
  return map[t] ?? t.replace(/([a-z])([A-Z])/g, "$1 $2");
}
