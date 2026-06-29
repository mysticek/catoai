/**
 * Text-to-speech. On the desktop we use the native macOS `say` (for local testing
 * and a speaker-less dev loop). The mobile client speaks `speech.say` natively
 * (expo-speech). Cloud TTS would be an optional fallback only.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export interface Tts {
  readonly kind: string;
  speak(text: string, locale?: string): Promise<void>;
}

/** macOS `say`. Uses a Slovak voice when available, else the system default. */
export class SayTts implements Tts {
  readonly kind = "macos-say";
  constructor(private readonly voice?: string) {}

  async speak(text: string): Promise<void> {
    const args = this.voice ? ["-v", this.voice, text] : [text];
    await exec("say", args).catch(() => {});
  }
}
