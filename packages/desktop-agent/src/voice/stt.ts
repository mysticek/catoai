/**
 * Speech-to-text — local-first (docs/ARCHITECTURE.md §1). Prefers a warm whisper.cpp
 * SERVER (model stays loaded → ~1s/clip) and falls back to the one-shot `whisper-cli`.
 * whisper wants 16 kHz mono WAV; the caller normalizes via ffmpeg first.
 */

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { readFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";

const exec = promisify(execFile);

export interface Stt {
  readonly kind: string;
  transcribe(wavPath: string, locale?: string): Promise<string>;
}

const lang = (locale = "auto"): string => (locale || "auto").split("-")[0] || "auto";

/** Warm whisper.cpp server: POST the WAV to /inference (model already in memory). */
export class WhisperServerStt implements Stt {
  readonly kind = "whisper-server";
  constructor(private readonly url: string) {}

  async transcribe(wavPath: string, locale = "auto"): Promise<string> {
    const buf = await readFile(wavPath);
    const fd = new FormData();
    fd.append("file", new Blob([buf], { type: "audio/wav" }), "audio.wav");
    fd.append("response_format", "json");
    fd.append("language", lang(locale));
    const res = await fetch(`${this.url}/inference`, { method: "POST", body: fd });
    if (!res.ok) throw new Error(`whisper-server HTTP ${res.status}`);
    const data = (await res.json()) as { text?: string };
    return (data.text ?? "").trim();
  }
}

/** One-shot whisper-cli (cold per call); fallback when no server. */
export class WhisperCppStt implements Stt {
  readonly kind = "whisper.cpp";
  constructor(
    private readonly bin: string,
    private readonly model: string,
  ) {}

  async transcribe(wavPath: string, locale = "auto"): Promise<string> {
    const outBase = `${wavPath}.out`;
    await exec(this.bin, ["-m", this.model, "-f", wavPath, "-l", lang(locale), "-nt", "-np", "-otxt", "-of", outBase]);
    const txt = await readFile(`${outBase}.txt`, "utf8").catch(() => "");
    await unlink(`${outBase}.txt`).catch(() => {});
    return txt.replace(/\s+/g, " ").trim();
  }
}

async function serverUp(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}

/** Ensure a warm whisper-server is running; spawn it (detached) if not. */
export async function ensureWhisperServer(model: string, url: string, bin = "whisper-server"): Promise<boolean> {
  if (await serverUp(url)) return true;
  if (!existsSync(model)) return false;
  const port = new URL(url).port || "8088";
  const child = spawn(bin, ["-m", model, "--host", "127.0.0.1", "--port", port, "-l", "auto"], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  for (let i = 0; i < 20; i++) {
    if (await serverUp(url)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/** Pick the best available STT: warm server > one-shot CLI > none. */
export async function createStt(opts: { bin: string; model: string; serverUrl: string }): Promise<Stt | null> {
  if (await serverUp(opts.serverUrl)) return new WhisperServerStt(opts.serverUrl);
  if (existsSync(opts.model)) return new WhisperCppStt(opts.bin, opts.model);
  return null;
}
