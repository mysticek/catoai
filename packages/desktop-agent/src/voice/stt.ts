/**
 * Speech-to-text — local-first (docs/ARCHITECTURE.md §1). Runs whisper.cpp on the
 * desktop so audio never leaves the machine. Slovak + English + mixed technical.
 *
 * whisper.cpp wants 16 kHz mono WAV. The mobile client (or a test harness) provides
 * that; we transcribe and hand the text to the Orchestrator.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";

const exec = promisify(execFile);

export interface Stt {
  readonly kind: string;
  /** Transcribe a 16 kHz mono WAV file to text. `locale` like "sk" / "en" / "auto". */
  transcribe(wavPath: string, locale?: string): Promise<string>;
}

export class WhisperCppStt implements Stt {
  readonly kind = "whisper.cpp";
  constructor(
    private readonly bin: string,
    private readonly model: string,
  ) {}

  async transcribe(wavPath: string, locale = "auto"): Promise<string> {
    const lang = (locale || "auto").split("-")[0] || "auto"; // "sk-SK" -> "sk"
    const outBase = `${wavPath}.out`;
    // -nt no timestamps, -np no progress, -otxt write <of>.txt
    await exec(this.bin, [
      "-m", this.model, "-f", wavPath, "-l", lang,
      "-nt", "-np", "-otxt", "-of", outBase,
    ]);
    const txt = await readFile(`${outBase}.txt`, "utf8").catch(() => "");
    await unlink(`${outBase}.txt`).catch(() => {});
    return txt.replace(/\s+/g, " ").trim();
  }
}

/** Returns a whisper STT if the model file exists, else null (audio path disabled). */
export function createStt(bin: string, model: string): Stt | null {
  if (!existsSync(model)) return null;
  return new WhisperCppStt(bin, model);
}
