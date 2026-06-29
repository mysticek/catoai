/**
 * Known Cato machines — persisted to a JSON file (expo-file-system, no native dep).
 * Each is a desktop running the Cato agent the phone can connect to. The agent reports
 * its hostname + platform in `welcome`, so a machine gets a real name once connected.
 */
import * as FileSystem from "expo-file-system/legacy";

export interface Machine {
  address: string; // ws URL — may change with DHCP
  id?: string; // stable agent-generated id — the real identity (dedupe key)
  name?: string; // hostname, learned on connect
  platform?: string; // darwin | linux | win32
  lastSeen?: number;
  discovered?: boolean; // found live on the network via mDNS (not from saved list)
  online?: boolean; // reachable right now (responded to /info) — drives the status dot
}

export interface MachineInfo {
  id?: string;
  host?: string;
  platform?: string;
}

/**
 * Record a machine's identity at the current address, deduping by stable id so a machine
 * that changed IP updates in place instead of piling up duplicates. Removes any prior
 * entry with the same id OR the same address, then keeps a single merged record.
 */
export function applyIdentity(list: Machine[], address: string, info: MachineInfo): Machine[] {
  if (!info.id) {
    return upsert(list, { address, name: info.host, platform: info.platform, online: true, lastSeen: Date.now() });
  }
  const prev = list.find((m) => m.id === info.id) ?? list.find((m) => m.address === address);
  const merged: Machine = {
    ...prev,
    address,
    id: info.id,
    name: info.host ?? prev?.name,
    platform: info.platform ?? prev?.platform,
    online: true,
    lastSeen: Date.now(),
  };
  return [...list.filter((m) => m.id !== info.id && m.address !== address), merged];
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

/** Fetch a machine's clean UTF-8 identity over HTTP (reliable, unlike mDNS TXT). */
export async function fetchMachineInfo(address: string): Promise<MachineInfo | null> {
  const base = address.replace(/^ws(s?):\/\//i, "http$1://").replace(/\/v1\/?$/i, "");
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(`${base}/info`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    return (await res.json()) as MachineInfo;
  } catch {
    return null;
  }
}

/** List the project folders the agent can start an agent in (under its workspace root). */
export async function fetchFolders(address: string): Promise<{ root: string; folders: string[] } | null> {
  const base = address.replace(/^ws(s?):\/\//i, "http$1://").replace(/\/v1\/?$/i, "");
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(`${base}/folders`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    return (await res.json()) as { root: string; folders: string[] };
  } catch {
    return null;
  }
}

/** Display name for a machine: its network/host name, else the host from its address. */
export function machineLabel(m: Machine): string {
  if (m.name) return m.name.replace(/\.local\.?$/i, "");
  const host = m.address.replace(/^wss?:\/\//i, "").split(/[:/]/)[0];
  return host || "Cato desktop";
}

/** Nice label for the platform an agent reports. */
export function platformLabel(platform?: string): string {
  if (platform === "darwin") return "macOS";
  if (platform === "win32") return "Windows";
  if (platform === "linux") return "Linux";
  return "Desktop";
}
