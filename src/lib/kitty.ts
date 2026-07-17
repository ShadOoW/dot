import { readdirSync, readFileSync } from "fs";
import { basename } from "path";
import { run } from "./spawn.ts";

// Helpers for kitty remote control (`kitten @`). Requires kitty.conf:
//   allow_remote_control yes
//   listen_on unix:/tmp/kitty

export interface ClaudeWindow {
  socket: string;
  windowId: number;
  title: string;
  cwd: string;
  isSelf: boolean;
}

export interface KittyFgProcess {
  pid?: number;
  cwd?: string;
  cmdline?: string[];
}

export interface KittyWindow {
  id: number;
  pid?: number;
  title?: string;
  cwd?: string;
  is_focused?: boolean;
  foreground_processes?: KittyFgProcess[];
}

export interface KittyTab {
  id?: number;
  title?: string;
  is_focused?: boolean;
  windows?: KittyWindow[];
}

export interface KittyOsWindow {
  id?: number;
  wm_class?: string;
  is_focused?: boolean;
  tabs?: KittyTab[];
}

/**
 * Sockets of live kitty instances. /tmp accumulates stale kitty-* sockets
 * across reboots, so each candidate's PID suffix is checked against
 * /proc/<pid>/comm. The current instance ($KITTY_LISTEN_ON) sorts first.
 */
export function liveSockets(): string[] {
  const sockets: string[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync("/tmp");
  } catch {
    return sockets;
  }
  for (const entry of entries) {
    const m = entry.match(/^kitty-(\d+)$/);
    if (!m) continue;
    try {
      if (readFileSync(`/proc/${m[1]}/comm`, "utf-8").trim() !== "kitty") continue;
    } catch {
      continue;
    }
    sockets.push(`unix:/tmp/${entry}`);
  }
  const own = process.env.KITTY_LISTEN_ON;
  if (own) sockets.sort((a, b) => (a === own ? -1 : b === own ? 1 : 0));
  return sockets;
}

/** PID of the kitty instance behind a `unix:/tmp/kitty-<pid>` socket. */
export function socketPid(socket: string): number | null {
  const m = socket.match(/^unix:\/tmp\/kitty-(\d+)$/);
  return m ? Number(m[1]) : null;
}

/** `kitten @ ls` against one socket; null on timeout, error, or bad JSON. */
export async function kittenLs(socket: string): Promise<KittyOsWindow[] | null> {
  const result = await Promise.race([
    run(["kitten", "@", "--to", socket, "ls"]),
    new Promise<null>((r) => setTimeout(() => r(null), 3000)),
  ]);
  if (!result || result.exitCode !== 0) return null;
  try {
    return JSON.parse(result.stdout) as KittyOsWindow[];
  } catch {
    return null;
  }
}

/**
 * Windows (across all live kitty instances) whose foreground process is the
 * claude binary. Matches argv[0] basename exactly — MCP servers and wrappers
 * also show up in foreground_processes, so substring matching is unsafe.
 */
export async function findClaudeWindows(match?: string): Promise<ClaudeWindow[]> {
  const found: ClaudeWindow[] = [];
  for (const socket of liveSockets()) {
    const osWindows = await kittenLs(socket);
    if (!osWindows) continue;
    for (const osWin of osWindows) {
      for (const tab of osWin.tabs ?? []) {
        for (const win of tab.windows ?? []) {
          const claudeProc = (win.foreground_processes ?? []).find(
            (p) => p.cmdline?.[0] && basename(p.cmdline[0]) === "claude",
          );
          if (!claudeProc) continue;
          found.push({
            socket,
            windowId: win.id,
            title: win.title ?? "",
            cwd: claudeProc.cwd ?? "",
            isSelf: socket === process.env.KITTY_LISTEN_ON && String(win.id) === process.env.KITTY_WINDOW_ID,
          });
        }
      }
    }
  }
  if (!match) return found;
  const needle = match.toLowerCase();
  return found.filter((w) => w.title.toLowerCase().includes(needle) || w.cwd.toLowerCase().includes(needle));
}

/** send-text interprets C-style escapes; escape backslashes so text stays literal. */
export async function sendText(socket: string, windowId: number, text: string): Promise<boolean> {
  const r = await run(["kitten", "@", "--to", socket, "send-text", "--match", `id:${windowId}`, "--", text.replaceAll("\\", "\\\\")]);
  return r.exitCode === 0;
}

/**
 * Press Enter via send-key (not "\r" through send-text): Claude Code enables
 * the kitty keyboard protocol, and send-key encodes Enter for whatever
 * protocol flags the window has active.
 */
export async function sendEnter(socket: string, windowId: number): Promise<boolean> {
  const r = await run(["kitten", "@", "--to", socket, "send-key", "--match", `id:${windowId}`, "enter"]);
  return r.exitCode === 0;
}

export async function getScreenText(socket: string, windowId: number): Promise<string | null> {
  const r = await run(["kitten", "@", "--to", socket, "get-text", "--match", `id:${windowId}`, "--extent", "screen"]);
  return r.exitCode === 0 ? r.stdout : null;
}

export function notify(urgency: "normal" | "critical", title: string, body: string): void {
  Bun.spawnSync(["notify-send", "--app-name=dot", "-u", urgency, title, body], { stdout: "ignore", stderr: "ignore" });
}
