/**
 * Known Cato machines — persisted to a JSON file (expo-file-system, no native dep).
 * Each is a desktop running the Cato agent the phone can connect to. The agent reports
 * its hostname + platform in `welcome`, so a machine gets a real name once connected.
 */
import * as FileSystem from "expo-file-system/legacy";
import * as SecureStore from "expo-secure-store";

export interface Machine {
  address: string; // ws URL — may change with DHCP
  id?: string; // stable agent-generated id — the real identity (dedupe key)
  name?: string; // hostname, learned on connect
  platform?: string; // darwin | linux | win32
  token?: string; // pairing token (from `cato setup`) — required to connect
  pub?: string; // agent public key (pinned) → end-to-end encrypted session
  lastSeen?: number;
  discovered?: boolean; // found live on the network via mDNS (not from saved list)
  online?: boolean; // reachable right now (responded to /info)
  secured?: boolean; // the machine ran `cato setup` (privileged endpoints enabled)
  onboarded?: boolean; // config.json exists on the machine
}

export interface MachineInfo {
  id?: string;
  host?: string;
  platform?: string;
  secured?: boolean;
  onboarded?: boolean;
  pub?: string;
}

/**
 * Record a machine's identity at the current address, deduping by stable id so a machine
 * that changed IP updates in place instead of piling up duplicates. Removes any prior
 * entry with the same id OR the same address, then keeps a single merged record.
 */
export function applyIdentity(list: Machine[], address: string, info: MachineInfo): Machine[] {
  if (!info.id) {
    return upsert(list, { address, name: info.host, platform: info.platform, secured: info.secured, onboarded: info.onboarded, pub: info.pub, online: true, lastSeen: Date.now() });
  }
  const prev = list.find((m) => m.id === info.id) ?? list.find((m) => m.address === address);
  const merged: Machine = {
    ...prev,
    address,
    id: info.id,
    name: info.host ?? prev?.name,
    platform: info.platform ?? prev?.platform,
    secured: info.secured,
    onboarded: info.onboarded,
    pub: info.pub ?? prev?.pub,
    online: true,
    lastSeen: Date.now(),
  };
  return [...list.filter((m) => m.id !== info.id && m.address !== address), merged];
}

const FILE = FileSystem.documentDirectory + "cato-machines.json";

// Pairing tokens are secrets → kept in the device Keychain/Keystore (expo-secure-store)
// keyed by the stable machine id. If secure storage isn't available (e.g. the native
// module isn't built into this binary yet), we fall back to keeping the token in the file
// so pairing still persists across restarts — and migrate to the Keychain once available.
const tokenKey = (id: string) => `cato.token.${id.replace(/[^A-Za-z0-9._-]/g, "_")}`;
let _secure: boolean | undefined;
async function secureOk(): Promise<boolean> {
  if (_secure === undefined) {
    try { _secure = await SecureStore.isAvailableAsync(); } catch { _secure = false; }
  }
  return _secure;
}
export async function saveToken(id: string, token: string): Promise<void> {
  if (!(await secureOk())) return; // kept in the file by saveMachines instead
  try { await SecureStore.setItemAsync(tokenKey(id), token); } catch { _secure = false; }
}
export async function loadToken(id: string): Promise<string | undefined> {
  if (!(await secureOk())) return undefined;
  try { return (await SecureStore.getItemAsync(tokenKey(id))) ?? undefined; } catch { return undefined; }
}
export async function deleteToken(id: string): Promise<void> {
  if (!(await secureOk())) return;
  try { await SecureStore.deleteItemAsync(tokenKey(id)); } catch { /* best-effort */ }
}

export async function loadMachines(): Promise<Machine[]> {
  try {
    const txt = await FileSystem.readAsStringAsync(FILE);
    const list = JSON.parse(txt) as Machine[];
    if (!Array.isArray(list)) return [];
    // Tokens come from the Keychain when available; otherwise they're already in the file.
    if (await secureOk()) for (const m of list) if (m.id) m.token = (await loadToken(m.id)) ?? m.token;
    return list;
  } catch {
    return [];
  }
}

export async function saveMachines(list: Machine[]): Promise<void> {
  try {
    // Strip tokens from the file ONLY when the Keychain is holding them; otherwise keep
    // them so pairing survives a restart.
    const keep = !(await secureOk());
    const out = keep ? list : list.map((m) => { const c: Machine = { ...m }; delete c.token; return c; });
    await FileSystem.writeAsStringAsync(FILE, JSON.stringify(out));
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

/** http(s) base URL from a ws(s) address (strips the /v1 path). */
const httpBase = (address: string): string =>
  address.replace(/^ws(s?):\/\//i, "http$1://").replace(/\/v1\/?$/i, "");

/** Browse subfolders under the agent's workspace root (nested; path is root-relative). */
export async function browseFolders(
  address: string,
  path = "",
  token?: string,
): Promise<{ root: string; path: string; dirs: string[] } | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(`${httpBase(address)}/folders?path=${encodeURIComponent(path)}`, {
      signal: ctrl.signal,
      headers: token ? { "x-cato-token": token } : undefined,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    return (await res.json()) as { root: string; path: string; dirs: string[] };
  } catch {
    return null;
  }
}

/** Create a folder (root-relative path, nested ok). */
export async function createFolder(address: string, path: string, token?: string): Promise<boolean> {
  try {
    const res = await fetch(`${httpBase(address)}/folders`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { "x-cato-token": token } : {}) },
      body: JSON.stringify({ path }),
    });
    return res.ok;
  } catch {
    return false;
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
