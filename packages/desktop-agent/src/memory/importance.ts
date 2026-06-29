/**
 * Importance scoring + event extraction from raw terminal lines.
 * Cheap heuristics first (no LLM). See docs/MEMORY-SCHEMA.md §2, §4.
 *
 * Raw lines are the high-volume stream Cato owns. Most are noise (low
 * importance, kept only as capture_line). A small set match detectors and become
 * typed domain events in the `event` table.
 */

import type { EventType } from "@cato/shared";

// eslint-disable-next-line no-control-regex
const ANSI = /\[[0-9;?]*[ -/]*[@-~]/g;

/* eslint-disable no-control-regex */
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g; // hyperlinks/titles: ESC ] ... BEL/ST
const ESC_OTHER = /\x1b[@-Z\\-_]/g; // other single-char escapes
const CTRL = /[\x00-\x08\x0b-\x1f\x7f]/g; // stray control chars (lines already split)
/* eslint-enable no-control-regex */

/** Strip ANSI/OSC escape sequences and control chars from a captured terminal line. */
export function clean(line: string): string {
  return line
    .replace(OSC, "")
    .replace(ANSI, "")
    .replace(ESC_OTHER, "")
    .replace(CTRL, "")
    .replace(/\r$/, "")
    .trimEnd();
}

/** 0..1 heuristic importance for a (cleaned) line. 0 means "skip / pure noise". */
export function scoreLine(line: string): number {
  const t = line.trim();
  if (t.length === 0) return 0;
  let score = 0.1;
  if (/\b(error|fail(ed|ure|ing)?|exception|panic|fatal)\b/i.test(t)) score += 0.5;
  if (/\bwarn(ing)?\b/i.test(t)) score += 0.2;
  if (/\b(deploy|deployment|migrat|commit|push)\b/i.test(t)) score += 0.25;
  if (/[?]\s*$/.test(t) || /\(y\/n\)/i.test(t)) score += 0.2; // looks like a prompt
  if (/\b(done|complete|finished|success|passed)\b/i.test(t)) score += 0.15;
  return Math.min(1, score);
}

export interface Detection {
  type: EventType;
  data: Record<string, unknown>;
  summary: string;
}

interface Detector {
  test: RegExp;
  build: (line: string, project: string) => Detection;
}

const DETECTORS: Detector[] = [
  {
    test: /\b(tests? failed|\d+ (tests? )?fail(ed|ing)|FAILED|✗)\b/i,
    build: (line, project) => ({
      type: "TestsFailed",
      data: { project, summary: line.trim() },
      summary: `${project}: tests failing`,
    }),
  },
  {
    // Real runtime / build errors: "Error: ...", "error TSxxxx", "Exception", panics.
    test: /(^|\s)(uncaught|unhandled|error:|exception\b|panic:|fatal:|error ts\d+)/i,
    build: (line, project) => ({
      type: "WorkerError",
      data: { project, summary: line.trim().slice(0, 200) },
      summary: `${project}: chyba — ${line.trim().slice(0, 80)}`,
    }),
  },
  {
    test: /\bdeploy(ing|ment started)?\b/i,
    build: (line, project) => ({
      type: "DeploymentStarted",
      data: { project, target: "unknown" },
      summary: `${project}: deployment started`,
    }),
  },
  {
    test: /\bdeploy(ment)? (succeeded|complete|finished|failed)\b/i,
    build: (line, project) => ({
      type: "DeploymentFinished",
      data: {
        project,
        target: "unknown",
        status: /failed/i.test(line) ? "failed" : "ok",
      },
      summary: `${project}: deployment ${/failed/i.test(line) ? "failed" : "finished"}`,
    }),
  },
  {
    test: /\(y\/n\)|do you want to proceed|permission to|approve\?/i,
    build: (line, project) => ({
      type: "ApprovalRequested",
      data: { taskId: "", question: line.trim() },
      summary: `${project}: waiting for your decision`,
    }),
  },
];

/** Run all detectors against a cleaned line; return any matches. */
export function detect(line: string, project: string): Detection[] {
  const out: Detection[] = [];
  for (const d of DETECTORS) {
    if (d.test.test(line)) out.push(d.build(line, project));
  }
  return out;
}
