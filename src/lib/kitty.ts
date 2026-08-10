import { readFileSync } from "fs";
import { basename } from "path";
import { agentForCmdline } from "./agents.ts";

// The one adapter for kitty remote control. Requires kitty.conf:
//   allow_remote_control yes
//   listen_on unix:${XDG_RUNTIME_DIR}/kitty
//
// ── Why this talks the wire protocol instead of shelling out to `kitten @` ──────
// kitty's control socket takes DCS-framed JSON: ESC P @kitty-cmd {json} ESC \.
// That is exactly what `kitten @` writes; the binary adds nothing but argument
// parsing. And it is a 26 MB Go binary, so every call paid a fork + exec + page
// fault storm: 20-46 ms measured per invocation on this box.
//
// findWindows() calls it once per live instance, sequentially. With the 10 kitty
// instances a normal desktop session here has, one sweep cost 330 ms — and it is
// on the hot path of `dot cue` and `dot session`.
// Straight down the socket, in parallel, the same sweep is ~7 ms.


/**
 * kitty refuses commands from a client claiming a version NEWER than itself and
 * has no lower bound, so a floor well below anything installed is both safe and
 * forward-compatible. There is no per-command version gating in kitty's rc/.
 */
const RC_VERSION = [0, 20, 0];
const RC_TIMEOUT_MS = 3000;
const DCS_PREFIX = "\x1bP@kitty-cmd";
const DCS_TERM = "\x1b\\";

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
  /** The Wayland app_id / X11 WM_CLASS the os-window was created with. */
  wm_class?: string;
  is_focused?: boolean;
  tabs?: KittyTab[];
}

interface RcResponse {
  ok: boolean;
  /** JSON string for commands that return a value (ls, get-text); absent otherwise. */
  data?: string;
  error?: string;
}

/**
 * One remote-control command. Resolves null on connect failure, timeout, or an
 * unparseable reply — a dead instance is never an exception, only an absence.
 */
function rc(socket: string, cmd: string, payload: Record<string, unknown>): Promise<RcResponse | null> {
  const path = socket.startsWith("unix:") ? socket.slice(5) : socket;
  const { promise, resolve } = Promise.withResolvers<RcResponse | null>();
  let settled = false;
  let buf = "";
  const finish = (value: RcResponse | null) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolve(value);
  };
  const timer = setTimeout(() => finish(null), RC_TIMEOUT_MS);
  Bun.connect({
    unix: path,
    socket: {
      open(sock) {
        sock.write(`${DCS_PREFIX}${JSON.stringify({ cmd, version: RC_VERSION, payload })}${DCS_TERM}`);
      },
      data(sock, chunk) {
        buf += chunk.toString();
        const end = buf.indexOf(DCS_TERM);
        const start = buf.indexOf(DCS_PREFIX);
        if (end < 0 || start < 0 || end < start) return;
        // Settle before closing: sock.end() runs the close handler
        // synchronously, and that handler resolves null — reversing these two
        // lines makes every command silently return "no response".
        try {
          finish(JSON.parse(buf.slice(start + DCS_PREFIX.length, end)) as RcResponse);
        } catch {
          finish(null);
        }
        sock.end();
      },
      close: () => finish(null),
      error: () => finish(null),
    },
  }).catch(() => finish(null));
  return promise;
}

/**
 * Sockets of live kitty instances, taken from the kernel's socket table rather
 * than from a directory listing.
 *
 * Guessing the directory is a bug factory. `listen_on` moved from /tmp to
 * $XDG_RUNTIME_DIR, and a scan of either one is blind to every instance started
 * under the other setting — which would have included the reboot handoff that
 * `dot session` exists to perform, the one moment losing the window list
 * is unrecoverable. /proc/net/unix names the path of every socket some process
 * has actually bound, wherever it lives, so this also makes liveness exact:
 * a socket file orphaned by a SIGKILLed kitty is simply not in the table.
 *
 * The trailing "-<pid>" is kitty appending the instance pid to listen_on. comm
 * is still checked so callers can trust socketPid().
 */
export function liveSockets(): string[] {
  let table: string;
  try {
    table = readFileSync("/proc/net/unix", "utf-8");
  } catch {
    return [];
  }
  const sockets: string[] = [];
  for (const line of table.split("\n")) {
    // Path is the last field, and is absent for unnamed sockets.
    const path = line.slice(line.lastIndexOf(" ") + 1);
    const m = path.match(/\/kitty-(\d+)$/);
    if (!m) continue;
    try {
      if (readFileSync(`/proc/${m[1]}/comm`, "utf-8").trim() !== "kitty") continue;
    } catch {
      continue;
    }
    sockets.push(`unix:${path}`);
  }
  const own = process.env.KITTY_LISTEN_ON;
  if (own) sockets.sort((a, b) => (a === own ? -1 : b === own ? 1 : 0));
  return sockets;
}

/** PID of the kitty instance behind a `unix:<dir>/kitty-<pid>` socket. */
export function socketPid(socket: string): number | null {
  const m = basename(socket).match(/^kitty-(\d+)$/);
  return m ? Number(m[1]) : null;
}

/** `ls` against one socket; null on timeout, error, or bad JSON. */
export async function listOsWindows(socket: string): Promise<KittyOsWindow[] | null> {
  const r = await rc(socket, "ls", {});
  if (!r?.ok || r.data === undefined) return null;
  try {
    return JSON.parse(r.data) as KittyOsWindow[];
  } catch {
    return null;
  }
}

export const SHELL_NAMES: Record<string, true> = {
  zsh: true, "-zsh": true, bash: true, "-bash": true, fish: true, "-fish": true, sh: true, "-sh": true,
};

/**
 * The user-invoked process in a window's foreground group. The group contains
 * wrappers and helpers too (for an agent window: the wrapper, the agent, and
 * its MCP servers at once) — a coding agent wins outright, otherwise the
 * lowest-pid non-noise process is the user-invoked parent (npm, bun, nvim, …).
 * Null = plain shell.
 *
 * Agent detection is delegated to the adapter table rather than matched on
 * argv[0]: only `claude` ships as an ELF binary, so every other agent appears
 * as `bun /path/to/<agent>` and an argv[0] test silently demotes it to a
 * generic command — which restore then "restores" by re-running that argv,
 * producing a fresh agent with an empty context.
 */
export function primaryProc(fg: KittyFgProcess[] | undefined): KittyFgProcess | null {
  const procs = (fg ?? []).filter((p) => p.cmdline?.length);
  const agent = procs.find((p) => agentForCmdline(p.cmdline!) != null);
  if (agent) return agent;
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
 * are running. `match` filters by title/cwd/app substring. Instances are
 * queried concurrently — they are independent processes, and one wedged
 * instance must not add its timeout to every other one's latency.
 */
export async function findWindows(match?: string): Promise<TermWindow[]> {
  const sockets = liveSockets();
  const listings = await Promise.all(sockets.map((s) => listOsWindows(s)));
  const found: TermWindow[] = [];
  for (const [i, osWindows] of listings.entries()) {
    if (!osWindows) continue;
    const socket = sockets[i]!;
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

/**
 * Paste text into a window. Sent base64, which is what the protocol's `data`
 * field is for: the `text:` form runs through kitty's C-escape expansion, so
 * literal text had to be backslash-escaped on the way in and any non-ASCII
 * byte was at the mercy of the JSON transport.
 */
export async function sendText(socket: string, windowId: number, text: string): Promise<boolean> {
  const data = `base64:${Buffer.from(text, "utf-8").toString("base64")}`;
  return (await rc(socket, "send-text", { data, match: `id:${windowId}` }))?.ok === true;
}

/**
 * Press keys via send-key (not escape codes through send-text): TUIs like
 * Claude Code enable the kitty keyboard protocol, and kitty encodes each key
 * for whatever protocol flags the target window has active. Key names are
 * kitty's (enter, tab, esc, up, ctrl+c, …).
 */
export async function sendKeys(socket: string, windowId: number, keys: string[]): Promise<boolean> {
  return (await rc(socket, "send-key", { keys, match: `id:${windowId}` }))?.ok === true;
}

export async function getScreenText(socket: string, windowId: number): Promise<string | null> {
  const r = await rc(socket, "get-text", { match: `id:${windowId}`, extent: "screen" });
  return r?.ok ? (r.data ?? "") : null;
}

export function notify(urgency: "normal" | "critical", title: string, body: string): void {
  Bun.spawnSync(["notify-send", "--app-name=dot", "-u", urgency, title, body], { stdout: "ignore", stderr: "ignore" });
}
