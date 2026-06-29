/**
 * mDNS discovery — browse the LAN for Cato agents advertising `_cato._tcp` and turn each
 * into a Machine the Pair screen can connect to. Uses react-native-zeroconf (a native
 * module → requires a dev build / prebuild). Degrades gracefully to no discovery if the
 * native module isn't present (e.g. before rebuilding).
 */
import { useEffect, useState } from "react";
import Zeroconf from "react-native-zeroconf";
import type { Machine } from "./machines";

interface ZcService {
  name?: string;
  fullName?: string;
  host?: string;
  port?: number;
  addresses?: string[];
  txt?: { host?: string; path?: string; v?: string };
}

/** Best human name from a resolved service, trying every field the libs expose.
 *  Returns undefined if nothing usable (caller falls back to the address). */
function serviceName(s: ZcService): string | undefined {
  const candidates = [
    s.txt?.host,
    (s.name ?? "").replace(/^Cato\s*[-·]\s*/i, ""), // our instance name "Cato - <host>"
    (s.fullName ?? "").split("._cato.")[0].replace(/^Cato\s*[-·]\s*/i, ""),
    (s.host ?? "").replace(/\.local\.?$/i, ""),
  ];
  for (const c of candidates) {
    const v = c?.trim();
    if (v && !/^\d+\.\d+\.\d+\.\d+$/.test(v)) return v; // skip if it's just an IP
  }
  return undefined;
}

/** Returns Cato machines currently discoverable on the network (live while `active`). */
export function useDiscovery(active: boolean): Machine[] {
  const [found, setFound] = useState<Machine[]>([]);

  useEffect(() => {
    if (!active) return;
    let zc: any;
    try {
      zc = new Zeroconf();
    } catch {
      return; // native module not linked yet (pre-rebuild) → no discovery
    }

    const onResolved = (s: ZcService) => {
      const ip = (s.addresses ?? []).find((a) => a.includes(".")) ?? s.host;
      if (!ip || !s.port) return;
      const path = s.txt?.path ?? "/v1";
      const address = `ws://${ip}:${s.port}${path}`;
      const name = serviceName(s);
      setFound((prev) => (prev.some((m) => m.address === address) ? prev : [...prev, { address, name, discovered: true }]));
    };

    zc.on("resolved", onResolved);
    zc.on("error", () => {});
    try {
      zc.scan("cato", "tcp", "local.");
    } catch {
      /* ignore */
    }

    return () => {
      try {
        zc.stop();
        zc.removeDeviceListeners();
      } catch {
        /* ignore */
      }
      setFound([]);
    };
  }, [active]);

  return found;
}
