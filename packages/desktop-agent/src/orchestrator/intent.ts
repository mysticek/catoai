/**
 * Intent parsing — turn a spoken command (Slovak / English / mixed) into a typed
 * intent. Cheap matching for the MVP command set (docs/MVP.md §3).
 *
 * Robustness: matching runs on a DE-ACCENTED, lower-cased copy, AND command
 * keywords are matched FUZZILY (small edit distance). Local STT mis-hears short
 * Slovak words ("zastav"→"zastau"/"zastal", "zhrnutie"→"zhernutie") — fuzzy matching
 * recovers the intent without overfitting to specific errors. The original text is
 * preserved for the message we forward to a worker.
 */

export type Intent =
  | { kind: "status" }
  | { kind: "projectStatus"; project: string }
  | { kind: "tell"; project?: string; message: string }
  | { kind: "spawnWorker"; agentKind: string; project: string }
  | { kind: "continue"; project?: string }
  | { kind: "stop"; project?: string }
  | { kind: "repeat" }
  | { kind: "summarize" }
  | { kind: "unknown"; text: string };

const deaccent = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

const TELL_VERBS = new Set(["tell", "povedz", "napis", "odkaz", "say"]);
const SPAWN_VERBS = new Set(["spusti", "spustit", "spustite", "start", "nahod", "zapni", "launch"]);
const AGENT_KINDS: Record<string, string> = {
  claude: "claude-code", claudea: "claude-code", codex: "codex", gemini: "gemini-cli",
};
const SPAWN_SKIP = new Set(["na", "projekte", "projekt", "projektu", "on", "v", "vo", "worker", "workera", "agenta", "agent"]);

/** Keyword → max edit distance that still counts as a match. */
type Kw = [word: string, maxDist: number];

const STOP: Kw[] = [["zastav", 1], ["stop", 1], ["stoj", 1], ["prestan", 2], ["koniec", 2]];
const CONTINUE: Kw[] = [["pokracuj", 2], ["pokracovat", 2], ["continue", 2], ["dalej", 1]];
const REPEAT: Kw[] = [["zopakuj", 2], ["repeat", 1], ["znova", 1]];
const SUMMARIZE: Kw[] = [["zhrnutie", 2], ["zhrn", 1], ["sumarizuj", 2], ["summary", 2], ["summarize", 2]];

export function parseIntent(raw: string): Intent {
  const text = raw.trim();
  const t = deaccent(text.toLowerCase());
  const tokens = t
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, "")) // strip punctuation ("zastau."→"zastau")
    .filter(Boolean);

  if (fuzzyAny(tokens, STOP)) return { kind: "stop" };
  if (fuzzyAny(tokens, CONTINUE)) return { kind: "continue" };
  if (fuzzyAny(tokens, REPEAT)) return { kind: "repeat" };
  if (fuzzyAny(tokens, SUMMARIZE)) return { kind: "summarize" };

  // "spusti claude na projekte X" / "start codex on X" / "spusti workera na X"
  if (SPAWN_VERBS.has(tokens[0] ?? "")) {
    let agentKind = "claude-code";
    for (const tk of tokens) if (AGENT_KINDS[tk]) agentKind = AGENT_KINDS[tk]!;
    let project: string | undefined;
    for (let i = tokens.length - 1; i >= 1; i--) {
      const tk = tokens[i]!;
      if (!SPAWN_SKIP.has(tk) && !AGENT_KINDS[tk] && !SPAWN_VERBS.has(tk)) { project = tk; break; }
    }
    if (project) return { kind: "spawnWorker", agentKind, project };
  }

  // "tell claude …" / "povedz claudovi …" — token-based to keep the original message.
  const rawTokens = text.split(/\s+/);
  const verb0 = deaccent((rawTokens[0] ?? "").toLowerCase());
  if (TELL_VERBS.has(verb0) && rawTokens.length >= 3) {
    const who = deaccent((rawTokens[1] ?? "").toLowerCase());
    const message = stripLeadingFiller(rawTokens.slice(2).join(" "));
    const project = /^claud(e|ovi)$/.test(who) ? undefined : who;
    return { kind: "tell", project, message };
  }

  // "what is X doing" / "čo robí X" / "ako je na tom X"
  const proj = t.match(/(?:what(?:'s| is)|co robi|ako (?:je na tom|napreduje))\s+([\w-]+)/);
  if (proj && !["happening", "going", "new"].includes(proj[1]!)) {
    return { kind: "projectStatus", project: proj[1]! };
  }

  // "what is happening" / "čo sa deje" — fuzzy on the key word, anchored by "čo"/"stav".
  const enHappening = /(what(?:'s| is) happening|what's new)/.test(t);
  const skHappening = tokens.includes("co") && fuzzyAny(tokens, [["deje", 2], ["robi", 1]]);
  if (enHappening || skHappening || /\bstav\b/.test(t)) return { kind: "status" };

  return { kind: "unknown", text };
}

function fuzzyAny(tokens: string[], keywords: Kw[]): boolean {
  return keywords.some(([w, d]) => tokens.some((tok) => withinDistance(tok, w, d)));
}

/** True if Levenshtein(a,b) <= max. Early-exits on length gap. */
function withinDistance(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  if (a === b) return true;
  return levenshtein(a, b) <= max;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let cur = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n]!;
}

/** Drop "to ", "nech ", "aby " so the worker gets a clean instruction. */
function stripLeadingFiller(s: string): string {
  return s.replace(/^(to|nech|aby|ze|že)\s+/i, "").trim();
}
