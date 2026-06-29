/**
 * A friendly, human network name for this machine — what the phone shows in the device
 * list. On macOS that's the user-set Computer Name ("Vladimir's MacBook Pro"); elsewhere
 * the OS hostname. Cached (it doesn't change at runtime).
 */
import { hostname } from "node:os";
import { execFileSync } from "node:child_process";

let cached: string | undefined;

export function friendlyHost(): string {
  if (cached) return cached;
  let name = hostname().replace(/\.local\.?$/i, "");
  try {
    if (process.platform === "darwin") {
      const computer = execFileSync("scutil", ["--get", "ComputerName"], { encoding: "utf8" }).trim();
      if (computer) name = computer;
    }
  } catch {
    /* fall back to hostname */
  }
  cached = name;
  return name;
}
