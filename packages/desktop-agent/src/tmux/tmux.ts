/**
 * Thin tmux wrapper. Cato runs each worker in a tmux pane it owns, streams the
 * pane to a capture file via `pipe-pane`, and injects input via `send-keys`.
 * The pane survives even if Cato crashes — this enables worker recovery.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** Cato-SPAWNED sessions (managed, recovery-eligible). */
export const SESSION_PREFIX = "cato_";
/** User sessions launched via the `cato` wrapper — auto-adopted + captured. */
export const ADOPT_PREFIX = "cato-";

export async function hasTmux(): Promise<boolean> {
  try {
    await exec("tmux", ["-V"]);
    return true;
  } catch {
    return false;
  }
}

export async function hasSession(name: string): Promise<boolean> {
  try {
    await exec("tmux", ["has-session", "-t", name]);
    return true;
  } catch {
    return false;
  }
}

/** Create a detached tmux session running `command` in `cwd`. */
export async function newSession(
  name: string,
  command: string,
  cwd: string,
): Promise<void> {
  await exec("tmux", ["new-session", "-d", "-s", name, "-c", cwd, command]);
}

/** Create a detached session running just the default shell (so the pane survives
 *  when the worker process inside it exits — required for recovery). */
export async function newShellSession(name: string, cwd: string): Promise<void> {
  await exec("tmux", ["new-session", "-d", "-s", name, "-c", cwd]);
}

/** The program currently running in a pane (e.g. "node", "cat", or "zsh" when the
 *  worker has exited back to the shell). Returns null if the pane/session is gone. */
export async function paneCurrentCommand(target: string): Promise<string | null> {
  try {
    const { stdout } = await exec("tmux", [
      "display-message", "-p", "-t", target, "#{pane_current_command}",
    ]);
    return stdout.trim() || null;
  } catch {
    return null; // pane/session no longer exists
  }
}

/** Stream a pane's output (appending) to `file`. `-o` only-on, no echo back. */
export async function pipePaneToFile(target: string, file: string): Promise<void> {
  await exec("tmux", ["pipe-pane", "-o", "-t", target, `cat >> '${file}'`]);
}

/** Send a line of text to the pane, then press Enter. */
export async function sendLine(target: string, text: string): Promise<void> {
  await exec("tmux", ["send-keys", "-t", target, "-l", "--", text]);
  await exec("tmux", ["send-keys", "-t", target, "Enter"]);
}

/** Send a control/named key (e.g. "C-c", "Escape", "Enter") — not literal text. */
export async function sendKey(target: string, key: string): Promise<void> {
  await exec("tmux", ["send-keys", "-t", target, key]);
}

export async function killSession(name: string): Promise<void> {
  await exec("tmux", ["kill-session", "-t", name]).catch(() => {});
}

/** Open a real desktop terminal window attached to a session (so it's visible/usable on the
 *  computer too). macOS: Terminal.app via osascript; Linux: a common terminal emulator. */
export async function openInTerminal(target: string): Promise<void> {
  const safe = target.replace(/[^A-Za-z0-9._-]/g, "");
  if (process.platform === "darwin") {
    await exec("osascript", [
      "-e", `tell application "Terminal" to do script "tmux attach -t ${safe}"`,
      "-e", `tell application "Terminal" to activate`,
    ]);
  } else if (process.platform === "linux") {
    await exec("sh", ["-c", `x-terminal-emulator -e "tmux attach -t ${safe}" || gnome-terminal -- tmux attach -t ${safe} || konsole -e tmux attach -t ${safe}`]);
  }
}

/** The current working directory of a session's active pane (its real project folder). */
export async function paneCwd(target: string): Promise<string | null> {
  try {
    const { stdout } = await exec("tmux", ["display-message", "-p", "-t", target, "#{pane_current_path}"]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** How many tmux clients are attached to a session (a desktop terminal is a client). */
async function clientCount(target: string): Promise<number> {
  try {
    const session = target.split(":")[0] ?? target;
    const { stdout } = await exec("tmux", ["list-clients", "-t", session, "-F", "x"]);
    return stdout.split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

/** Reflow a phone viewer's pane to its width — but ONLY when no desktop terminal is attached,
 *  so we never shrink the user's real terminal. When a client is attached we leave the window
 *  following the desktop (full size); the phone then just wraps. */
export async function resizeWindow(target: string, cols: number, rows: number): Promise<void> {
  if (await clientCount(target) > 0) {
    await exec("tmux", ["set-window-option", "-t", target, "window-size", "largest"]).catch(() => {});
    return;
  }
  const c = Math.max(20, Math.min(400, Math.floor(cols)));
  const r = Math.max(10, Math.min(200, Math.floor(rows)));
  await exec("tmux", ["set-window-option", "-t", target, "window-size", "manual"]).catch(() => {});
  await exec("tmux", ["resize-window", "-t", target, "-x", String(c), "-y", String(r)]).catch(() => {});
}

/** Let the window follow its attached client(s) again (restores the desktop size). */
export async function autoSizeWindow(target: string): Promise<void> {
  await exec("tmux", ["set-window-option", "-t", target, "window-size", "largest"]).catch(() => {});
  await exec("tmux", ["resize-window", "-t", target, "-A"]).catch(() => {}); // snap to attached client
}

/** List Cato-owned sessions (those with our prefix). */
export async function listSessions(): Promise<string[]> {
  return (await listAllSessions()).filter((s) => s.startsWith(SESSION_PREFIX));
}

/** List every tmux session on the host (for adopting user-started workers). */
export async function listAllSessions(): Promise<string[]> {
  try {
    const { stdout } = await exec("tmux", ["list-sessions", "-F", "#{session_name}"]);
    return stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return []; // no server running
  }
}

/**
 * Dump a pane's existing scrollback (full history) once, so we can backfill memory
 * when adopting a worker that was already running before Cato showed up.
 */
export async function capturePaneHistory(target: string): Promise<string> {
  try {
    const { stdout } = await exec("tmux", ["capture-pane", "-p", "-J", "-S", "-", "-t", target]);
    return stdout;
  } catch {
    return "";
  }
}

/**
 * Snapshot the pane's CURRENTLY VISIBLE grid — already rendered, so spacing is
 * correct (unlike the raw pipe-pane byte stream, which garbles TUIs). Used by the
 * snapshot capture driver to get clean text from interactive agents (e.g. claude).
 */
export async function capturePaneVisible(target: string): Promise<string | null> {
  try {
    const { stdout } = await exec("tmux", ["capture-pane", "-p", "-t", target]);
    return stdout;
  } catch {
    return null; // pane gone
  }
}

/** Like capturePaneVisible but includes up to `lines` of scrollback, so a phone viewer can
 *  scroll back through recent history (not just the current screen). */
export async function capturePaneScreen(target: string, lines: number): Promise<string | null> {
  try {
    const back = Math.max(0, Math.min(2000, Math.floor(lines)));
    // -e keeps ANSI colours so the phone can render greyed suggestions, highlighting, etc.
    const { stdout } = await exec("tmux", ["capture-pane", "-p", "-e", "-t", target, "-S", `-${back}`]);
    return stdout;
  } catch {
    return null; // pane gone
  }
}
