/** Runtime configuration. Precedence: env var > ~/.cato/config.json (written by
 *  `cato setup`) > built-in default. See infra/.env.example. */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
  dbDir: string;
  wsHost: string;
  wsPort: number;
  pairingToken: string;
  embeddingModel: string;
  embeddingDim: number;
  sttBin: string;
  sttServerUrl: string;
  sttModel: string;
  ffmpegBin: string;
  workspaceRoot: string;
  llmModel: string;
}

export const CONFIG_FILE = join(homedir(), ".cato", "config.json");

function readSaved(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

export function loadConfig(): Config {
  const saved = readSaved();
  // env var wins (dev overrides), then the persisted setup, then the built-in default.
  const get = (envName: string, jsonKey: string, fallback: string): string =>
    process.env[envName] ?? saved[jsonKey] ?? fallback;

  return {
    // Embedded PGlite database directory (no Docker/Postgres server needed).
    dbDir: get("DB_DIR", "dbDir", `${homedir()}/.cato/db`),
    wsHost: get("WS_HOST", "wsHost", "0.0.0.0"),
    wsPort: Number(get("WS_PORT", "wsPort", "8787")),
    pairingToken: get("PAIRING_TOKEN", "pairingToken", "changeme"),
    embeddingModel: get("EMBEDDING_MODEL", "embeddingModel", "bge-m3"),
    embeddingDim: Number(get("EMBEDDING_DIM", "embeddingDim", "1024")),
    sttBin: get("STT_BIN", "sttBin", "whisper-cli"),
    sttServerUrl: get("STT_SERVER_URL", "sttServerUrl", "http://127.0.0.1:8088"),
    sttModel: get("STT_MODEL", "sttModel", `${homedir()}/.cato/models/ggml-large-v3-turbo.bin`),
    ffmpegBin: get("FFMPEG_BIN", "ffmpegBin", "ffmpeg"),
    // Where Cato looks for project folders when voice-spawning a worker.
    workspaceRoot: get("WORKSPACE_ROOT", "workspaceRoot", `${homedir()}/dev`),
    // gemma3:4b = non-reasoning multilingual instruct → clean Slovak summaries + JSON
    // intent classification (qwen3 is a reasoning model and leaks its thinking into prose).
    llmModel: get("LLM_MODEL", "llmModel", "gemma3:4b"),
  };
}
