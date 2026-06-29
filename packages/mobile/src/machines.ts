/**
 * Known Cato machines — persisted to a JSON file (expo-file-system, no native dep).
 * Each is a desktop running the Cato agent the phone can connect to. The agent reports
 * its hostname + platform in `welcome`, so a machine gets a real name once connected.
 */
import * as FileSystem from "expo-file-system/legacy";

export interface Machine {
  address: string; // ws URL — the stable id
  name?: string; // hostname, learned on connect
  platform?: string; // darwin | linux | win32
  lastSeen?: number;
  discovered?: boolean; // found live on the network via mDNS (not from saved list)
}

const FILE = FileSystem.documentDirectory + "cato-machines.json";

export async function loadMachines(): Promise<Machine[]> {
  try {
    const txt = await FileSystem.readAsStringAsync(FILE);
    const list = JSON.parse(txt) as Machine[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function saveMachines(list: Machine[]): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(FILE, JSON.stringify(list));
  } catch {
    /* best-effort */
  }
}

/** Insert or update a machine by address (its id). */
export function upsert(list: Machine[], m: Machine): Machine[] {
  const i = list.findIndex((x) => x.address === m.address);
  if (i === -1) return [...list, m];
  const next = [...list];
  next[i] = { ...next[i], ...m };
  return next;
}

/** Nice label for the platform an agent reports. */
export function platformLabel(platform?: string): string {
  if (platform === "darwin") return "macOS";
  if (platform === "win32") return "Windows";
  if (platform === "linux") return "Linux";
  return "Desktop";
}
