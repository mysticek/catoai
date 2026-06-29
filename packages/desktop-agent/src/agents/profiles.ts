/**
 * Worker profiles — the ONLY agent-specific knowledge. A profile is just a launch
 * command (+ optional resume) and any detectors unique to that tool. Everything
 * else is the generic TerminalAgent. This is what keeps Cato agent-agnostic.
 */

export interface WorkerProfile {
  /** Adapter kind, e.g. "claude-code". */
  kind: string;
  /** Command to launch the worker in a tmux pane. */
  command: string;
  /** Build the launch command to resume a prior session, if the tool supports it. */
  resumeCommand?: (sessionId: string) => string;
}

export const CLAUDE_CODE: WorkerProfile = {
  kind: "claude-code",
  command: "claude",
  resumeCommand: (id) => `claude --resume ${id}`,
};

export const CODEX: WorkerProfile = { kind: "codex", command: "codex" };
export const GEMINI: WorkerProfile = { kind: "gemini-cli", command: "gemini" };

export const PROFILES: Record<string, WorkerProfile> = {
  [CLAUDE_CODE.kind]: CLAUDE_CODE,
  [CODEX.kind]: CODEX,
  [GEMINI.kind]: GEMINI,
};
