/**
 * The typed intent the Orchestrator acts on. There is NO regex parsing — the LLM
 * classifies free-form commands (English / Slovak / Czech, any phrasing) into one of
 * these (see Llm.classifyIntent). This keeps intent understanding robust and language-
 * agnostic instead of brittle keyword matching.
 */

export type Intent =
  | { kind: "status" }
  | { kind: "projectStatus"; project: string }
  | { kind: "tell"; project?: string; message: string }
  | { kind: "spawnWorker"; agentKind: string; project: string }
  | { kind: "continue"; project?: string }
  | { kind: "stop"; project?: string }
  | { kind: "repeat" }
  | { kind: "summarize" }
  | { kind: "unknown"; text: string };
