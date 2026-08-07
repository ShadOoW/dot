import { readdirSync, readFileSync } from "fs";
import { basename } from "path";
import { run } from "./spawn.ts";

// Helpers for kitty remote control (`kitten @`). Requires kitty.conf:
//   allow_remote_control yes
//   listen_on unix:/tmp/kitty

export interface TermWindow {
  socket: string;
  windowId: number;
  title: string;
  cwd: string;
  /** Basename of the user-invoked foreground app (claude, nvim, btop, …); null = plain shell prompt. */
  app: string | null;
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

export const SHELL_NAMES: Record<string, true> = {
  zsh: true, "-zsh": true, bash: true, "-bash": true, fish: true, "-fish": true, sh: true, "-sh": true,
};

/**
 * The user-invoked process in a window's foreground group. The group contains
 * wrappers and helpers too (for a claude window: headroom + claude + MCP
 * servers at once) — claude wins outright, otherwise the lowest-pid non-noise
 * process is the user-invoked parent (npm, bun, nvim, …). Null = plain shell.
 */
export function primaryProc(fg: KittyFgProcess[] | undefined): KittyFgProcess | null {
  const procs = (fg ?? []).filter((p) => p.cmdline?.length);
  const claude = procs.find((p) => basename(p.cmdline![0]!) === "claude");
  if (claude) return claude;
  const candidates = procs.filter((p) => {
    const head = basename(p.cmdline![0]!);
    if (SHELL_NAMES[head]) return false;
    if (head.endsWith("-mcp")) return false;
    if (head === "headroom" || basename(p.cmdline![1] ?? "") === "headroom") return false;
    return true;
  });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (a.pid ?? Number.MAX_SAFE_INTEGER) - (b.pid ?? Number.MAX_SAFE_INTEGER));
  return candidates[0]!;
}

/**
 * All terminal windows across live kitty instances, tagged with the app they
 * are running. `match` filters by title/cwd/app substring.
 */
export async function findWindows(match?: string): Promise<TermWindow[]> {
  const found: TermWindow[] = [];
  for (const socket of liveSockets()) {
    const osWindows = await kittenLs(socket);
    if (!osWindows) continue;
    for (const osWin of osWindows) {
      for (const tab of osWin.tabs ?? []) {
        for (const win of tab.windows ?? []) {
          const proc = primaryProc(win.foreground_processes);
          found.push({
            socket,
            windowId: win.id,
            title: win.title ?? "",
            cwd: proc?.cwd ?? win.cwd ?? "",
            app: proc ? basename(proc.cmdline![0]!) : null,
            isSelf: socket === process.env.KITTY_LISTEN_ON && String(win.id) === process.env.KITTY_WINDOW_ID,
          });
        }
      }
    }
  }
  if (!match) return found;
  const needle = match.toLowerCase();
  return found.filter(
    (w) =>
      w.title.toLowerCase().includes(needle) ||
      w.cwd.toLowerCase().includes(needle) ||
      (w.app?.toLowerCase().includes(needle) ?? false),
  );
}

/** send-text interprets C-style escapes; escape backslashes so text stays literal. */
export async function sendText(socket: string, windowId: number, text: string): Promise<boolean> {
  const r = await run(["kitten", "@", "--to", socket, "send-text", "--match", `id:${windowId}`, "--", text.replaceAll("\\", "\\\\")]);
  return r.exitCode === 0;
}

/**
 * Press keys via send-key (not escape codes through send-text): TUIs like
 * Claude Code enable the kitty keyboard protocol, and send-key encodes each
 * key for whatever protocol flags the window has active. Key names are
 * kitty's (enter, tab, esc, up, ctrl+c, …).
 */
export async function sendKeys(socket: string, windowId: number, keys: string[]): Promise<boolean> {
  const r = await run(["kitten", "@", "--to", socket, "send-key", "--match", `id:${windowId}`, ...keys]);
  return r.exitCode === 0;
}

export async function getScreenText(socket: string, windowId: number): Promise<string | null> {
  const r = await run(["kitten", "@", "--to", socket, "get-text", "--match", `id:${windowId}`, "--extent", "screen"]);
  return r.exitCode === 0 ? r.stdout : null;
}

export function notify(urgency: "normal" | "critical", title: string, body: string): void {
  Bun.spawnSync(["notify-send", "--app-name=dot", "-u", urgency, title, body], { stdout: "ignore", stderr: "ignore" });
}
