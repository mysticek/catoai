/**
 * ApprovalManager — holds tool-call approvals that are waiting for a human decision.
 *
 * Flow: an agent's PreToolUse gate hits Cato's HTTP endpoint → request() creates a
 * pending approval and returns a Promise the HTTP handler awaits. The phone/dashboard
 * answers with allow/deny → resolve() settles it. If nobody answers before the
 * timeout, it resolves to "ask" so the agent falls back to its own local prompt
 * (the developer can still approve at the desk — we never hard-block).
 */

import type { ApprovalRequest } from "@cato/shared";

export interface Decision {
  decision: "allow" | "deny" | "ask";
  reason?: string;
}

type Scope = "once" | "command" | "session";

export class ApprovalManager {
  #pending = new Map<string, { resolve: (d: Decision) => void; info: ApprovalRequest; key: string; session: string }>();
  // Anti-fatigue: standing allow-rules so multi-step runs don't ask 20 times.
  #alwaysAllow = new Set<string>(); // exact command/tool keys
  #sessionAllow = new Set<string>(); // whole worker sessions

  constructor(
    /** Called when a new approval needs a human (push to phone + dashboard). */
    private readonly onRequest: (a: ApprovalRequest) => void,
    /** Resolve to "ask" after this long (keep < the agent's hook timeout). */
    private readonly timeoutMs = 9 * 60 * 1000,
  ) {}

  /** Already covered by a standing allow-rule? → auto-approve without bothering the user. */
  isAutoAllowed(key: string, session: string): boolean {
    return this.#alwaysAllow.has(key) || this.#sessionAllow.has(session);
  }

  request(info: ApprovalRequest, key: string, session: string): Promise<Decision> {
    return new Promise<Decision>((resolve) => {
      const timer = setTimeout(() => {
        this.#pending.delete(info.id);
        resolve({ decision: "ask" });
      }, this.timeoutMs);
      this.#pending.set(info.id, {
        info,
        key,
        session,
        resolve: (d) => {
          clearTimeout(timer);
          this.#pending.delete(info.id);
          resolve(d);
        },
      });
      this.onRequest(info);
    });
  }

  resolve(id: string, decision: "allow" | "deny", reason?: string, scope: Scope = "once"): boolean {
    const p = this.#pending.get(id);
    if (!p) return false;
    if (decision === "allow" && scope === "command") this.#alwaysAllow.add(p.key);
    if (decision === "allow" && scope === "session") this.#sessionAllow.add(p.session);
    p.resolve({ decision, reason });
    return true;
  }

  /** Forget a session's allow-rule (e.g. when its worker stops). */
  clearSession(session: string): void {
    this.#sessionAllow.delete(session);
  }

  /** Currently-pending approvals (for a client that just connected). */
  list(): ApprovalRequest[] {
    return [...this.#pending.values()].map((p) => p.info);
  }
}

/** Stable key for allow-rules: exact command for Bash, tool+target otherwise. */
export function ruleKey(tool: string, title: string, detail: string): string {
  return tool === "Bash" ? `Bash:${detail.trim()}` : `${tool}:${title}`;
}

type Risk = "low" | "medium" | "high";

/** Turn a raw PreToolUse payload into a glanceable approval card: short title,
 *  risk badge, stats, and a (collapsible) full detail. */
export function summarizeToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  cwd?: string,
): { title: string; detail: string; risk: Risk; stats: string } {
  const str = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v, null, 2));
  const base = (p: string): string => p.split("/").filter(Boolean).pop() ?? p;

  switch (toolName) {
    case "Bash": {
      const cmd = str(toolInput.command ?? toolInput);
      return { title: "Run command", detail: cmd, risk: bashRisk(cmd), stats: "" };
    }
    case "Edit":
    case "MultiEdit": {
      const file = str(toolInput.file_path ?? "?");
      const oldS = str(toolInput.old_string ?? toolInput.old_contents ?? "");
      const newS = str(toolInput.new_string ?? toolInput.new_contents ?? "");
      const detail = [...lines(oldS, "- "), ...lines(newS, "+ ")].join("\n");
      const added = count(newS);
      const removed = count(oldS);
      return {
        title: `Edit ${base(file)}`,
        detail: trim(detail),
        risk: fileRisk(file, cwd),
        stats: `+${added} −${removed} · 1 file`,
      };
    }
    case "Write": {
      const file = str(toolInput.file_path ?? "?");
      const content = str(toolInput.content ?? "");
      return {
        title: `Write ${base(file)}`,
        detail: trim(content),
        risk: fileRisk(file, cwd),
        stats: `${count(content)} lines · new file`,
      };
    }
    default:
      return { title: toolName, detail: trim(str(toolInput)), risk: "low", stats: "" };
  }
}

function bashRisk(cmd: string): Risk {
  if (/\brm\s+-rf|\bsudo\b|--force|\bgit\s+push\b.*\s-f|curl[^|]*\|\s*(sh|bash)|\bmkfs|\bdd\s|>\s*\/dev|chmod\s+777|:\(\)\s*\{|\bkillall\b/i.test(cmd)) return "high";
  if (/\b(rm|mv|git\s+(reset|clean|push)|npm\s+publish|drop\s+table|\bdelete\b|>\s)/i.test(cmd)) return "medium";
  return "low";
}

function fileRisk(file: string, cwd?: string): Risk {
  if (/\.env|secret|credential|id_rsa|\.ssh\/|\.pem|\.key$/i.test(file)) return "high";
  if (cwd && file.startsWith("/") && !file.startsWith(cwd)) return "high"; // outside the project
  return "low";
}

const lines = (s: string, prefix: string): string[] =>
  s ? s.split("\n").map((l) => prefix + l) : [];
const count = (s: string): number => (s ? s.split("\n").length : 0);

function trim(s: string, max = 4000): string {
  return s.length > max ? s.slice(0, max) + "\n…(truncated)" : s;
}
