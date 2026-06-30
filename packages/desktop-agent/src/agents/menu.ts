/**
 * Deterministic detection of an interactive selection menu from an agent's rendered
 * terminal screen. Used to surface "this agent is waiting on a choice" without an LLM
 * (which hallucinated menus from scrollback). A menu counts ONLY when the current screen
 * shows numbered options AND a navigation footer (Enter/↑↓/Esc) — i.e. it's live and
 * awaiting input. A resolved/scrolled-away menu has no footer → not detected.
 */
export interface ParsedMenu {
  question: string;
  options: string[];
  numbers: number[];
}

const OPTION_RE = /^\s*[›>❯]?\s*(\d+)[.)]\s+(.+?)\s*$/;
const FOOTER_RE = /to (select|navigate|cancel)|↑\/↓|esc to/i;
const SEP_RE = /^[─━—_│|╰╯╭╮▁▔=·.\s]+$/;

export function parseMenu(screen: string): ParsedMenu | null {
  if (!screen) return null;
  const lines = screen.split("\n");
  if (!lines.some((l) => FOOTER_RE.test(l))) return null;

  const opts: { n: number; label: string }[] = [];
  for (const raw of lines) {
    const m = raw.match(OPTION_RE);
    if (!m) continue;
    const n = Number.parseInt(m[1] ?? "", 10);
    const label = (m[2] ?? "").replace(/\s+/g, " ").trim();
    if (label && !opts.some((o) => o.n === n)) opts.push({ n, label });
  }
  if (opts.length < 2) return null;

  const firstIdx = lines.findIndex((l) => OPTION_RE.test(l));
  let question = "";
  for (let i = firstIdx - 1; i >= 0 && i > firstIdx - 8; i--) {
    const t = (lines[i] ?? "").trim();
    if (!t || SEP_RE.test(t) || /^[›>❯*]/.test(t)) continue;
    question = t.replace(/^[□◇▸•◦\s]+/, "").trim();
    break;
  }
  return { question: question || "Choose an option", options: opts.map((o) => o.label), numbers: opts.map((o) => o.n) };
}
