/**
 * mDNS / Bonjour advertising — so phones on the same Wi-Fi auto-discover this Cato agent
 * (service type `_cato._tcp`) instead of typing an IP. The mobile app browses for it.
 */
import { Bonjour } from "bonjour-service";
import { machineId } from "../util/machine-id.js";

// `host` must be ASCII — mDNS TXT/service names get mojibake'd by some clients.
export function advertiseCato(port: number, host: string, version: string): () => void {
  let bonjour: Bonjour | undefined;
  try {
    bonjour = new Bonjour();
    bonjour.publish({
      name: `Cato - ${host}`,
      type: "cato", // → _cato._tcp
      protocol: "tcp",
      port,
      txt: { v: version, host, path: "/v1", id: machineId() },
    });
    console.log(`[cato] advertising _cato._tcp on :${port} as "Cato - ${host}"`);
  } catch (err) {
    console.log(`[cato] mDNS advertise failed (discovery off): ${(err as Error).message}`);
  }
  return () => {
    try {
      bonjour?.unpublishAll(() => bonjour?.destroy());
    } catch {
      /* best-effort */
    }
  };
}
