/**
 * Slovak phrasing — Cato speaks Slovak by default (docs/PROJECT.md §Voice).
 * Turns memory state into short, voice-ready sentences.
 */

import type { CatoEvent, ProjectStatus } from "@cato/shared";

export function sayStatus(statuses: ProjectStatus[]): string {
  if (statuses.length === 0) return "Zatiaľ sa nič nedeje.";
  return statuses.map(sayOne).join(". ") + ".";
}

function sayOne(s: ProjectStatus): string {
  const name = cap(s.name);
  switch (s.state) {
    case "waiting":
      return `${name} čaká na tvoje rozhodnutie`;
    case "attention":
      // Speak the real detail (e.g. the actual error), not a canned phrase.
      return `${name}: ${stripProjectPrefix(s.summary, s.name)}`;
    case "active":
      return `${name} práve pracuje`;
    default:
      return `${name} je nečinný`;
  }
}

export function sayProjectStatus(
  project: string,
  events: CatoEvent[],
  taskIntent?: string,
): string {
  if (events.length === 0 && !taskIntent) return `O projekte ${cap(project)} zatiaľ nič neviem.`;
  const parts: string[] = [];
  if (events.length) parts.push(stripProjectPrefix(events[0]!.summary ?? events[0]!.type, project));
  if (taskIntent && !/^(adoptovan|spusten)/i.test(taskIntent)) parts.push(`pracuje na: ${taskIntent}`);
  return `${cap(project)}: ${parts.join("; ")}.`;
}

export function saySpawned(agentKind: string, project: string): string {
  return `Spustil som ${agentKind} na projekte ${cap(project)}.`;
}

export function saySpawnFailed(reason: string): string {
  return `Nepodarilo sa spustiť worker: ${reason}.`;
}

export const SAY_NO_SPAWN = "Spúšťanie workerov nie je k dispozícii.";

export function saySummary(events: CatoEvent[]): string {
  if (events.length === 0) return "Nemám čo zhrnúť.";
  const top = events.slice(0, 3).map((e) => e.summary ?? e.type);
  return "Zhrnutie: " + top.join("; ") + ".";
}

export function sayTold(project: string, withContext = false): string {
  const ctx = withContext ? " s kontextom z pamäte" : "";
  return `Hotovo, poslal som ${cap(project)} správu${ctx}.`;
}

export function sayContinued(project: string): string {
  return `Hotovo, ${cap(project)} pokračuje.`;
}

export function sayStopped(project: string): string {
  return `Zastavil som ${cap(project)}.`;
}

export const SAY_NO_WORKER = "Nemám žiadneho aktívneho workera.";
export const SAY_UNKNOWN = "Nerozumiem. Skús to povedať inak.";
export const SAY_NOTHING_TO_REPEAT = "Nemám čo zopakovať.";

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Drop a leading "<project>: " that event summaries embed, to avoid doubling. */
function stripProjectPrefix(summary: string, project: string): string {
  const esc = project.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return summary.replace(new RegExp(`^${esc}:\\s*`, "i"), "");
}
