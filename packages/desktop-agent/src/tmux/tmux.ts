/**
 * Thin tmux wrapper. Cato runs each worker in a tmux pane it owns, streams the
 * pane to a capture file via `pipe-pane`, and injects input via `send-keys`.
 * The pane survives even if Cato crashes — this enables worker recovery.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export const SESSION_PREFIX = "cato_";

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
