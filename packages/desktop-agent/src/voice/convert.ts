/**
 * Audio conversion — turn ANY incoming clip (m4a/caf/aac/wav from a phone) into the
 * 16 kHz mono WAV whisper.cpp expects. This makes the mobile side format-agnostic:
 * the phone records in whatever native format, the desktop normalizes via ffmpeg.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** Convert `inputPath` to a sibling 16 kHz mono WAV; returns the wav path. */
export async function toWav16kMono(inputPath: string, ffmpegBin = "ffmpeg"): Promise<string> {
  const out = `${inputPath}.16k.wav`;
  await exec(ffmpegBin, [
    "-y",
    "-i", inputPath,
    "-ar", "16000", // 16 kHz
    "-ac", "1", // mono
    "-f", "wav",
    out,
  ]);
  return out;
}
