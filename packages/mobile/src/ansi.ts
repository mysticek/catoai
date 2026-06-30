/**
 * Minimal ANSI → styled-run parser for the terminal mirror. tmux capture -e emits SGR colour
 * codes; we turn them into { text, color } runs so the phone renders real terminal colours —
 * crucially, dim/grey suggestion text shows greyed instead of plain white.
 */
export interface AnsiRun {
  text: string;
  color: string;
  bold: boolean;
}

const SGR = /\x1b\[([0-9;]*)m/g; // colour codes
const ANY_ESC = /\x1b\[[0-9;?]*[A-Za-z]/g; // any CSI (to strip non-colour control)

/** Strip every ANSI escape — for plain-text checks (menu detection, blank lines). */
export function stripAnsi(s: string): string {
  return s.replace(ANY_ESC, "");
}

const FG = "#d6d7dd"; // default foreground
const DIM = "#74757f"; // greyed text (dim / suggestions)
// One Dark-ish 16-colour palette (0-7 normal, 8-15 bright).
const PALETTE = [
  "#3b3f4c", "#e06c75", "#98c379", "#e5c07b", "#61afef", "#c678dd", "#56b6c2", "#abb2bf",
  "#5c6370", "#e06c75", "#98c379", "#e5c07b", "#61afef", "#c678dd", "#56b6c2", "#d6d7dd",
];

function xterm256(n: number): string {
  if (n < 16) return PALETTE[n] ?? FG;
  if (n >= 232) { const v = 8 + (n - 232) * 10; return rgb(v, v, v); }
  const c = n - 16;
  const r = Math.floor(c / 36), g = Math.floor((c % 36) / 6), b = c % 6;
  const lvl = (x: number) => (x === 0 ? 0 : 55 + x * 40);
  return rgb(lvl(r), lvl(g), lvl(b));
}
const rgb = (r: number, g: number, b: number) => `#${[r, g, b].map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, "0")).join("")}`;

/** Parse one screen of ANSI text into styled runs (newlines preserved inside run text). */
export function parseAnsi(input: string): AnsiRun[] {
  // Drop non-colour control sequences first (cursor moves etc. shouldn't appear, but be safe).
  const text = input.replace(ANY_ESC, (m) => (m.endsWith("m") ? m : ""));
  const runs: AnsiRun[] = [];
  let fg: string | undefined;
  let dim = false;
  let bold = false;
  let i = 0;
  let m: RegExpExecArray | null;
  SGR.lastIndex = 0;
  const colorNow = () => (dim ? DIM : fg ?? FG);
  const push = (t: string) => { if (t) runs.push({ text: t, color: colorNow(), bold }); };
  while ((m = SGR.exec(text))) {
    push(text.slice(i, m.index));
    apply((m[1] ?? "").split(";"));
    i = SGR.lastIndex;
  }
  push(text.slice(i));
  return runs;

  function apply(codes: string[]): void {
    for (let k = 0; k < codes.length; k++) {
      const n = Number.parseInt(codes[k] ?? "", 10);
      if (Number.isNaN(n) || n === 0) { fg = undefined; dim = false; bold = false; }
      else if (n === 1) bold = true;
      else if (n === 2) dim = true;
      else if (n === 22) { bold = false; dim = false; }
      else if (n === 39) fg = undefined;
      else if (n >= 30 && n <= 37) fg = PALETTE[n - 30];
      else if (n >= 90 && n <= 97) fg = PALETTE[n - 90 + 8];
      else if (n === 38) {
        if (codes[k + 1] === "5") { fg = xterm256(Number.parseInt(codes[k + 2] ?? "", 10) || 0); k += 2; }
        else if (codes[k + 1] === "2") { fg = rgb(+(codes[k + 2] ?? 0), +(codes[k + 3] ?? 0), +(codes[k + 4] ?? 0)); k += 4; }
      }
      // background / other codes ignored
    }
  }
}
