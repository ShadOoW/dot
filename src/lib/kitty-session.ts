import { mkdir } from "fs/promises";
import { join } from "path";
import { STATE_DIR } from "./config.ts";
import { shellEscape } from "./spawn.ts";

// Generator for kitty --session startup files. Only universally-supported
// directives are emitted (new_tab / cd / launch) — launch-action flags like
// --hold vary across kitty versions.

export const SESSIONS_DIR = join(STATE_DIR, "kitty-sessions");

export interface SessionWindow {
  cwd: string;
  /** Shell command line; omitted → plain login shell. */
  cmd?: string;
}

export interface SessionTab {
  title: string;
  windows: SessionWindow[];
}

/**
 * Commands run through a login shell so .zprofile PATH (fnm, bun,
 * ~/.local/bin) applies, and drop to an interactive shell instead of closing
 * the window when the command exits or crashes.
 */
export function launchArgv(win: SessionWindow): string[] {
  return win.cmd ? ["zsh", "-l", "-c", `${win.cmd}; exec zsh -l`] : ["zsh", "-l"];
}

/**
 * new_tab/cd take the rest of the line verbatim (no shlex), so quoting would
 * become literal — strip newlines instead so a title/cwd can't inject extra
 * session directives.
 */
function sessionLineSafe(s: string): string {
  return s.replace(/[\r\n]+/g, " ");
}

/** kitty parses launch lines with shlex — POSIX single-quoting is safe. */
export function buildSessionFile(tabs: SessionTab[]): string {
  const lines: string[] = [];
  for (const tab of tabs) {
    lines.push(`new_tab ${sessionLineSafe(tab.title)}`);
    for (const win of tab.windows) {
      lines.push(`cd ${sessionLineSafe(win.cwd)}`);
      lines.push(`launch ${shellEscape(launchArgv(win))}`);
    }
  }
  return lines.join("\n") + "\n";
}

export async function writeSessionFile(name: string, content: string): Promise<string> {
  await mkdir(SESSIONS_DIR, { recursive: true });
  const path = join(SESSIONS_DIR, `${name}.session`);
  await Bun.write(path, content);
  return path;
}
