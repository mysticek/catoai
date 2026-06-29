/**
 * FileTailSource — tails a growing file (our capture log) like `tail -F`, yielding
 * complete lines. Handles the file not existing yet and truncation (rotation).
 */

import { open, stat } from "node:fs/promises";
import type { CaptureSource } from "./source.js";

export interface FileTailOptions {
  /** Start from the beginning of the file instead of the current end. */
  fromStart?: boolean;
  /** Poll interval in ms. */
  pollMs?: number;
}

export class FileTailSource implements CaptureSource {
  #closed = false;

  constructor(
    private readonly path: string,
    private readonly opts: FileTailOptions = {},
  ) {}

  close(): void {
    this.#closed = true;
  }

  async *lines(): AsyncIterable<string> {
    const pollMs = this.opts.pollMs ?? 150;
    let offset = this.opts.fromStart ? 0 : await this.#currentSize();
    let buffer = "";

    while (!this.#closed) {
      const size = await this.#currentSize();
      if (size < offset) offset = 0; // truncated/rotated
      if (size > offset) {
        const length = size - offset;
        const fh = await open(this.path, "r");
        try {
          const buf = Buffer.alloc(length);
          const { bytesRead } = await fh.read(buf, 0, length, offset);
          offset += bytesRead;
          buffer += buf.toString("utf8", 0, bytesRead);
        } finally {
          await fh.close();
        }
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          yield buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
        }
      } else {
        await delay(pollMs);
      }
    }
  }

  async #currentSize(): Promise<number> {
    try {
      return (await stat(this.path)).size;
    } catch {
      return 0; // not created yet
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
