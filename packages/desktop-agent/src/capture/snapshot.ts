/**
 * SnapshotCaptureSource — clean capture for interactive TUI agents (claude, etc.).
 *
 * Instead of tailing the raw byte stream (pipe-pane), which a full-screen TUI
 * garbles with cursor moves, we periodically snapshot the *rendered* pane grid
 * (`tmux capture-pane -p`) — spacing is already correct. We then emit lines that:
 *   (a) are STABLE: present in two consecutive snapshots (filters transient spinner
 *       frames like "Razzmatazzing…"), and
 *   (b) have not been emitted before.
 * UI chrome (box borders / separators) is dropped.
 *
 * Trade-off: we only see the visible screen, so extremely fast-scrolling output can
 * be missed. For conversational agents whose answers linger on screen, this is ideal.
 */

import type { CaptureSource } from "./source.js";
import { clean } from "../memory/importance.js";
import { capturePaneVisible } from "../tmux/tmux.js";

const CHROME = /^[\s─-╿▀-▟>·❯⏺✻✽✳←—|]+$/u;

function isChrome(line: string): boolean {
  return line.trim().length === 0 || CHROME.test(line);
}

export interface SnapshotOptions {
  pollMs?: number;
  /** Max distinct emitted lines remembered (de-dup window). */
  memoryCap?: number;
}

export class SnapshotCaptureSource implements CaptureSource {
  #closed = false;
  #emitted = new Set<string>();
  #order: string[] = [];
  readonly #pollMs: number;
  readonly #cap: number;

  constructor(
    private readonly target: string,
    opts: SnapshotOptions = {},
  ) {
    this.#pollMs = opts.pollMs ?? 1000;
    this.#cap = opts.memoryCap ?? 1000;
  }

  close(): void {
    this.#closed = true;
  }

  async *lines(): AsyncIterable<string> {
    let prev: string[] = [];
    while (!this.#closed) {
      const raw = await capturePaneVisible(this.target);
      if (raw === null) return; // pane gone
      const cur = raw
        .split("\n")
        .map((l) => clean(l))
        .filter((l) => !isChrome(l));

      const prevSet = new Set(prev);
      for (const line of cur) {
        if (prevSet.has(line) && !this.#emitted.has(line)) {
          this.#remember(line);
          yield line;
        }
      }
      prev = cur;
      await delay(this.#pollMs);
    }
  }

  #remember(line: string): void {
    this.#emitted.add(line);
    this.#order.push(line);
    if (this.#order.length > this.#cap) {
      for (const old of this.#order.splice(0, this.#cap / 2)) this.#emitted.delete(old);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
