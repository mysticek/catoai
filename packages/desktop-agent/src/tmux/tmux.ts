/**
 * Thin tmux wrapper. Cato runs each worker in a tmux pane it owns, streams the
 * pane to a capture file via `pipe-pane`, and injects input via `send-keys`.
 * The pane survives even if Cato crashes — this enables worker recovery.
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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
/** The terminal the user launched `cato` from (TERM_PROGRAM), saved by the wrapper. */
function userTerminal(): string {
  try { return readFileSync(join(homedir(), ".cato", "terminal"), "utf8").trim().toLowerCase(); } catch { return ""; }
}

/**
 * Open a session in a real desktop terminal — cross-platform. Prefers an explicit override
 * (config.desktopTerminal: "{cmd}"/"{session}"), then the terminal the user actually used,
 * then sensible per-OS fallbacks. macOS / Linux / Windows.
 */
export async function openInTerminal(target: string, override?: string): Promise<void> {
  const session = target.replace(/[^A-Za-z0-9._-]/g, "");
  const cmd = `tmux attach -t ${session}`;
  const sh = (line: string) =>
    exec(process.platform === "win32" ? "cmd" : "sh", [process.platform === "win32" ? "/c" : "-c", line]).then(() => {}, () => {});

  if (override && override.trim()) {
    const line = /\{cmd\}|\{session\}/.test(override)
      ? override.replace(/\{cmd\}/g, cmd).replace(/\{session\}/g, session)
      : `${override} ${cmd}`;
    return sh(line);
  }

  const prog = userTerminal();

  if (process.platform === "darwin") {
    if (prog.includes("ghostty") && existsSync("/Applications/Ghostty.app")) return void exec("open", ["-na", "Ghostty", "--args", "-e", "tmux", "attach", "-t", session]).catch(() => {});
    if (prog.includes("iterm")) return void exec("osascript", ["-e", `tell application "iTerm" to create window with default profile command "${cmd}"`]).catch(() => {});
    if (prog.includes("wezterm")) return void exec("wezterm", ["start", "--", "tmux", "attach", "-t", session]).catch(() => {});
    if (prog.includes("kitty")) return void exec("open", ["-na", "kitty", "--args", "tmux", "attach", "-t", session]).catch(() => {});
    // fallbacks: whatever is installed, Terminal.app last.
    if (existsSync("/Applications/Ghostty.app")) return void exec("open", ["-na", "Ghostty", "--args", "-e", "tmux", "attach", "-t", session]).catch(() => {});
    if (existsSync("/Applications/iTerm.app")) return void exec("osascript", ["-e", `tell application "iTerm" to create window with default profile command "${cmd}"`]).catch(() => {});
    return void exec("osascript", ["-e", `tell application "Terminal" to do script "${cmd}"`, "-e", `tell application "Terminal" to activate`]).catch(() => {});
  }

  if (process.platform === "linux") {
    const launch: Record<string, string> = {
      ghostty: `ghostty -e ${cmd}`,
      wezterm: `wezterm start -- ${cmd}`,
      kitty: `kitty ${cmd}`,
      alacritty: `alacritty -e ${cmd}`,
      "gnome-terminal": `gnome-terminal -- ${cmd}`,
      konsole: `konsole -e ${cmd}`,
      "xfce4-terminal": `xfce4-terminal -e "${cmd}"`,
      "x-terminal-emulator": `x-terminal-emulator -e "${cmd}"`,
      xterm: `xterm -e ${cmd}`,
    };
    const known = Object.keys(launch).find((k) => prog.includes(k));
    const order = [...(known ? [known] : []), "ghostty", "wezterm", "kitty", "alacritty", "gnome-terminal", "konsole", "xfce4-terminal", "x-terminal-emulator", "xterm"];
    const seen = new Set<string>();
    return sh(order.filter((k) => !seen.has(k) && seen.add(k)).map((k) => launch[k]).join(" || "));
  }

  if (process.platform === "win32") {
    // tmux on Windows means WSL; open Windows Terminal if present, else a WSL window.
    return sh(`start "" wt -w 0 nt wsl.exe -e bash -lc "${cmd}" || start "" wsl.exe -e bash -lc "${cmd}"`);
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
