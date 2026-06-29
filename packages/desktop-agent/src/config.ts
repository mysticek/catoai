/** Runtime configuration, loaded from environment (see infra/.env.example). */

export interface Config {
  databaseUrl: string;
  wsHost: string;
  wsPort: number;
  pairingToken: string;
  embeddingDim: number;
  sttBin: string;
  sttModel: string;
  workspaceRoot: string;
  llmModel: string;
}

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export function loadConfig(): Config {
  return {
    databaseUrl: env(
      "DATABASE_URL",
      "postgres://cato:cato@localhost:5433/cato",
    ),
    wsHost: env("WS_HOST", "0.0.0.0"),
    wsPort: Number(env("WS_PORT", "8787")),
    pairingToken: env("PAIRING_TOKEN", "changeme"),
    embeddingDim: Number(env("EMBEDDING_DIM", "768")),
    sttBin: env("STT_BIN", "whisper-cli"),
    sttModel: env(
      "STT_MODEL",
      `${process.env.HOME ?? ""}/.cato/models/ggml-base.bin`,
    ),
    // Where Cato looks for project folders when voice-spawning a worker.
    workspaceRoot: env("WORKSPACE_ROOT", `${process.env.HOME ?? ""}/dev`),
    llmModel: env("LLM_MODEL", "qwen2.5:1.5b"),
  };
}
