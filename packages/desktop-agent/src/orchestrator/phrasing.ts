/**
 * Phrasing — Cato's spoken replies in the user's chosen language (en / sk / cs).
 * The rich answers (status summaries, "what is X doing") go through the LLM in the
 * same language; these are the short canned confirmations.
 */

import type { CatoEvent as BossEvent, ProjectStatus } from "@cato/shared";

type Lang = "en" | "sk" | "cs";
const lang = (locale: string): Lang => {
  const l = (locale || "en").slice(0, 2).toLowerCase();
  return l === "sk" ? "sk" : l === "cs" ? "cs" : "en";
};

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function stripProjectPrefix(summary: string, project: string): string {
  const esc = project.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return summary.replace(new RegExp(`^${esc}:\\s*`, "i"), "");
}

// ---- per-language strings -----------------------------------------------------

const T = {
  en: {
    idle: (n: string) => `${n} is idle`,
    active: (n: string) => `${n} is working`,
    waiting: (n: string) => `${n} is waiting for your decision`,
    nothing: "Nothing is happening yet.",
    told: (n: string, ctx: boolean) => `Done, I sent ${n} a message${ctx ? " with context from memory" : ""}.`,
    continued: (n: string) => `Done, ${n} is continuing.`,
    stopped: (n: string) => `Stopped ${n}.`,
    spawned: (k: string, n: string) => `Started ${k} on project ${n}.`,
    spawnFail: (r: string) => `Couldn't start a worker: ${r}.`,
    noWorker: "No active worker.",
    unknown: "I didn't get that. Try saying it differently.",
    nothingRepeat: "Nothing to repeat.",
    noSpawn: "Starting workers isn't available.",
    summary: "Summary: ",
    noProject: (n: string) => `I don't know anything about ${n} yet.`,
    workingOn: "working on",
  },
  sk: {
    idle: (n: string) => `${n} je nečinný`,
    active: (n: string) => `${n} práve pracuje`,
    waiting: (n: string) => `${n} čaká na tvoje rozhodnutie`,
    nothing: "Zatiaľ sa nič nedeje.",
    told: (n: string, ctx: boolean) => `Hotovo, poslal som ${n} správu${ctx ? " s kontextom z pamäte" : ""}.`,
    continued: (n: string) => `Hotovo, ${n} pokračuje.`,
    stopped: (n: string) => `Zastavil som ${n}.`,
    spawned: (k: string, n: string) => `Spustil som ${k} na projekte ${n}.`,
    spawnFail: (r: string) => `Nepodarilo sa spustiť worker: ${r}.`,
    noWorker: "Nemám žiadneho aktívneho workera.",
    unknown: "Nerozumiem. Skús to povedať inak.",
    nothingRepeat: "Nemám čo zopakovať.",
    noSpawn: "Spúšťanie workerov nie je k dispozícii.",
    summary: "Zhrnutie: ",
    noProject: (n: string) => `O projekte ${n} zatiaľ nič neviem.`,
    workingOn: "pracuje na",
  },
  cs: {
    idle: (n: string) => `${n} je nečinný`,
    active: (n: string) => `${n} právě pracuje`,
    waiting: (n: string) => `${n} čeká na tvé rozhodnutí`,
    nothing: "Zatím se nic neděje.",
    told: (n: string, ctx: boolean) => `Hotovo, poslal jsem ${n} zprávu${ctx ? " s kontextem z paměti" : ""}.`,
    continued: (n: string) => `Hotovo, ${n} pokračuje.`,
    stopped: (n: string) => `Zastavil jsem ${n}.`,
    spawned: (k: string, n: string) => `Spustil jsem ${k} na projektu ${n}.`,
    spawnFail: (r: string) => `Nepodařilo se spustit worker: ${r}.`,
    noWorker: "Nemám žádného aktivního workera.",
    unknown: "Nerozumím. Zkus to říct jinak.",
    nothingRepeat: "Nemám co zopakovat.",
    noSpawn: "Spouštění workerů není k dispozici.",
    summary: "Shrnutí: ",
    noProject: (n: string) => `O projektu ${n} zatím nic nevím.`,
    workingOn: "pracuje na",
  },
} as const;

// ---- public API ---------------------------------------------------------------

export function sayStatus(statuses: ProjectStatus[], locale: string): string {
  const t = T[lang(locale)];
  if (statuses.length === 0) return t.nothing;
  return statuses.map((s) => sayOne(s, t)).join(". ") + ".";
}

function sayOne(s: ProjectStatus, t: (typeof T)[Lang]): string {
  const name = cap(s.name);
  switch (s.state) {
    case "waiting": return t.waiting(name);
    case "attention": return `${name}: ${stripProjectPrefix(s.summary, s.name)}`;
    case "active": return t.active(name);
    default: return t.idle(name);
  }
}

export function sayProjectStatus(
  project: string,
  events: BossEvent[],
  taskIntent: string | undefined,
  locale: string,
): string {
  const t = T[lang(locale)];
  if (events.length === 0 && !taskIntent) return t.noProject(cap(project));
  const parts: string[] = [];
  if (events.length) parts.push(stripProjectPrefix(events[0]!.summary ?? events[0]!.type, project));
  if (taskIntent && !/^(adoptovan|spusten)/i.test(taskIntent)) parts.push(`${t.workingOn}: ${taskIntent}`);
  return `${cap(project)}: ${parts.join("; ")}.`;
}

export function saySummary(events: BossEvent[], locale: string): string {
  const t = T[lang(locale)];
  if (events.length === 0) return t.nothing;
  return t.summary + events.slice(0, 3).map((e) => e.summary ?? e.type).join("; ") + ".";
}

export const sayTold = (project: string, withContext: boolean, locale: string): string =>
  T[lang(locale)].told(cap(project), withContext);
export const sayContinued = (project: string, locale: string): string =>
  T[lang(locale)].continued(cap(project));
export const sayStopped = (project: string, locale: string): string =>
  T[lang(locale)].stopped(cap(project));
export const saySpawned = (agentKind: string, project: string, locale: string): string =>
  T[lang(locale)].spawned(agentKind, cap(project));
export const saySpawnFailed = (reason: string, locale: string): string =>
  T[lang(locale)].spawnFail(reason);
export const sayNoWorker = (locale: string): string => T[lang(locale)].noWorker;
export const sayUnknown = (locale: string): string => T[lang(locale)].unknown;
export const sayNothingToRepeat = (locale: string): string => T[lang(locale)].nothingRepeat;
export const sayNoSpawn = (locale: string): string => T[lang(locale)].noSpawn;
