import { existsSync, readFileSync } from "fs";
import { mkdir, rename, rm } from "fs/promises";
import { basename, join } from "path";
import { claudeCommandForPid, liveClaudeSessions } from "./claude-registry.ts";
import { STATE_DIR } from "./config.ts";
import { logWarn } from "./console.ts";
import { kittenLs, liveSockets, socketPid, type KittyFgProcess } from "./kitty.ts";
import { getTree, walkTree, type SwayNode } from "./sway.ts";
import { shellEscape } from "./spawn.ts";
import type { SessionTab, SessionWindow } from "./kitty-session.ts";

// Save/restore of terminal sessions across a reboot: every kitty window's
// cwd + foreground command is captured, and claude windows are tagged with
// their session id AND the account they belong to (work / personal / bare)
// so they resume in the right config dir. Only one snapshot is kept at a time
// — a new save overwrites it — but the snapshot is DURABLE: restore reads it
// and leaves it in place, so it survives a re-restore, a partial failure, and
// an unplanned reboot. Recovery is always one `dot claude session restore` away
// until the next save replaces it.

export const SESSION_DIR = join(STATE_DIR, "session");
export const MANIFEST_PATH = join(SESSION_DIR, "manifest.json");
// The manifest holds the layout; a separate zero-byte sentinel is the one-shot
// "auto-restore on next login" token. Keeping them separate is what lets the
// manifest stay durable while login-restore still fires exactly once per save:
// login claims the token (atomic rename, so a crash/race can't double-fire),
// not the manifest. Fixed names — only one snapshot ever exists.
const AUTORESTORE_PATH = join(SESSION_DIR, "autorestore");
const AUTORESTORE_CLAIM_PATH = join(SESSION_DIR, "autorestore.claiming");

// Pre-warmed scratchpad kitties from the sway exec block — recreated on every
// login, so restoring them would duplicate them.
const SCRATCHPAD_APP_IDS = new Set(["terminal-mark", "music-mark", "yazi-explorer"]);
const SHELL_NAMES = new Set(["zsh", "-zsh", "bash", "-bash", "fish", "-fish", "sh", "-sh"]);

export type WindowKind = "claude" | "command" | "shell";

export interface ManifestWindow {
  cwd: string;
  title?: string;
  kind: WindowKind;
  command?: string[] | null;
  /** For claude windows: session id (null if unresolved) + resume launcher. */
  claude?: { sessionId: string | null; name?: string; command: string } | null;
}

export interface ManifestTab {
  title?: string;
  windows: ManifestWindow[];
}

export interface ManifestOsWindow {
  kittyPid: number | null;
  appId: string;
  workspace: number | null;
  tabs: ManifestTab[];
}

export interface Manifest {
  version: 1;
  savedAt: number;
  focusedWorkspace: number | null;
  osWindows: ManifestOsWindow[];
  skipped: {
    guiWindows: Array<{ appId: string; workspace: number | null }>;
    scratchpad: string[];
  };
  claudeUnmatched: Array<{ sessionId: string; cwd: string; name?: string; command: string }>;
}

/**
 * A kitty window's foreground_processes contains the whole fg process group —
 * for a claude window that is the headroom wrapper + claude + MCP servers at
 * once. Claude wins outright (its pid lets us join the session registry and
 * read its account); otherwise the lowest-pid non-noise process is the
 * user-invoked parent (npm, bun, nvim, …).
 */
export function classifyWindow(
  fg: KittyFgProcess[] | undefined,
): { kind: WindowKind; command?: string[]; claudePid?: number } {
  const procs = (fg ?? []).filter((p) => p.cmdline?.length);
  const claudeProc = procs.find((p) => basename(p.cmdline![0]!) === "claude");
  if (claudeProc) return { kind: "claude", claudePid: claudeProc.pid };
  const candidates = procs.filter((p) => {
    const head = basename(p.cmdline![0]!);
    if (SHELL_NAMES.has(head)) return false;
    if (head.endsWith("-mcp")) return false;
    if (head === "headroom" || basename(p.cmdline![1] ?? "") === "headroom") return false;
    return true;
  });
  if (candidates.length === 0) return { kind: "shell" };
  candidates.sort((a, b) => (a.pid ?? Number.MAX_SAFE_INTEGER) - (b.pid ?? Number.MAX_SAFE_INTEGER));
  return { kind: "command", command: candidates[0]!.cmdline };
}

interface Leaf {
  node: SwayNode;
  workspace: SwayNode | null;
}

/** Sway leaf for a kitty os-window: by instance pid, active-title tiebreak. */
function swayLeafFor(leaves: Leaf[], pid: number | null, activeTitle: string | undefined, used: Set<number>): Leaf | null {
  const mine = leaves.filter((l) => l.node.pid === pid && !used.has(l.node.id));
  if (mine.length === 0) return null;
  if (mine.length > 1) {
    const byTitle = mine.find((l) => activeTitle && l.node.name === activeTitle);
    if (byTitle) return byTitle;
    logWarn(`kitty pid ${pid} has ${mine.length} os-windows — workspace mapping may be off`);
  }
  return mine[0]!;
}

export async function captureManifest(): Promise<Manifest> {
  const sockets = liveSockets();
  const tree = await getTree();
  const leaves = [...walkTree(tree)];
  const sessions = liveClaudeSessions();
  const focused = leaves.find((l) => l.node.focused);

  const kittyPids = new Set<number>();
  const usedLeaves = new Set<number>();
  const matchedSessions = new Set<number>();
  const osWindows: ManifestOsWindow[] = [];
  const scratchpad: string[] = [];

  for (const socket of sockets) {
    const pid = socketPid(socket);
    if (pid != null) kittyPids.add(pid);
    const ls = await kittenLs(socket);
    if (!ls) continue;

    for (const osw of ls) {
      const activeTab = osw.tabs?.find((t) => t.is_focused) ?? osw.tabs?.[0];
      const activeWin = activeTab?.windows?.find((w) => w.is_focused) ?? activeTab?.windows?.[0];
      const leaf = swayLeafFor(leaves, pid, activeWin?.title, usedLeaves);
      if (leaf) usedLeaves.add(leaf.node.id);
      const appId = leaf?.node.app_id ?? "kitty";
      if (SCRATCHPAD_APP_IDS.has(appId) || leaf?.workspace?.name === "__i3_scratch") {
        scratchpad.push(appId);
        continue;
      }

      const tabs: ManifestTab[] = [];
      for (const tab of osw.tabs ?? []) {
        const windows: ManifestWindow[] = [];
        for (const win of tab.windows ?? []) {
          const cwd = win.cwd ?? win.foreground_processes?.[0]?.cwd ?? process.env.HOME!;
          const { kind, command, claudePid } = classifyWindow(win.foreground_processes);
          let claude: ManifestWindow["claude"] = null;
          if (kind === "claude") {
            // Join to the live registry by claude's own pid (bulletproof —
            // Claude Code keys its registry file on that pid), then fall back
            // to the kitty socket/window and finally a unique cwd.
            const byPid =
              claudePid != null ? sessions.find((s) => s.pid === claudePid && !matchedSessions.has(s.pid)) : undefined;
            const bySocket =
              byPid ??
              sessions.find(
                (s) => s.kittySocket === socket && s.kittyWindowId === win.id && !matchedSessions.has(s.pid),
              );
            const byCwd = bySocket ? null : sessions.filter((s) => s.cwd === cwd && !matchedSessions.has(s.pid));
            const match = bySocket ?? (byCwd?.length === 1 ? byCwd[0] : null);
            if (match) matchedSessions.add(match.pid);
            // Account: prefer the matched session, else read the process env
            // directly, else assume work (the primary account).
            const cmd =
              match?.command ?? (claudePid != null ? claudeCommandForPid(claudePid) : null) ?? "claude-work";
            claude = { sessionId: match?.sessionId ?? null, name: match?.name, command: cmd };
          }
          windows.push({ cwd, title: win.title, kind, command: command ?? null, claude });
        }
        if (windows.length > 0) tabs.push({ title: tab.title, windows });
      }
      if (tabs.length > 0) {
        osWindows.push({ kittyPid: pid, appId, workspace: leaf?.workspace?.num ?? null, tabs });
      }
    }
  }

  const guiWindows = leaves
    .filter((l) => l.node.pid != null && !kittyPids.has(l.node.pid) && l.workspace?.name !== "__i3_scratch")
    .map((l) => ({
      appId: l.node.app_id ?? l.node.window_properties?.class ?? l.node.name ?? "unknown",
      workspace: l.workspace?.num ?? null,
    }));

  return {
    version: 1,
    savedAt: Date.now(),
    focusedWorkspace: focused?.workspace?.num ?? null,
    osWindows,
    skipped: { guiWindows, scratchpad },
    claudeUnmatched: sessions
      .filter((s) => !matchedSessions.has(s.pid))
      .map((s) => ({ sessionId: s.sessionId, cwd: s.cwd, name: s.name, command: s.command })),
  };
}

export interface RestoreOsWindow {
  appId: string;
  workspace: number | null;
  tabs: SessionTab[];
}

export interface RestorePlan {
  windows: RestoreOsWindow[];
  claudeCount: number;
  notes: string[];
}

export function buildRestorePlan(m: Manifest): RestorePlan {
  const notes: string[] = [];
  let claudeCount = 0;

  // `claude-* -c` resumes the newest session for a cwd — only safe when
  // exactly one id-less claude window maps to that cwd.
  const idlessPerCwd = new Map<string, number>();
  for (const osw of m.osWindows)
    for (const tab of osw.tabs)
      for (const w of tab.windows)
        if (w.kind === "claude" && !w.claude?.sessionId)
          idlessPerCwd.set(w.cwd, (idlessPerCwd.get(w.cwd) ?? 0) + 1);

  const toSessionWindow = (w: ManifestWindow): SessionWindow => {
    if (w.kind === "claude") {
      const launcher = w.claude?.command ?? "claude-work";
      if (w.claude?.sessionId) {
        claudeCount++;
        return { cwd: w.cwd, cmd: `${launcher} --resume ${w.claude.sessionId}` };
      }
      if (idlessPerCwd.get(w.cwd) === 1) {
        claudeCount++;
        return { cwd: w.cwd, cmd: `${launcher} -c` };
      }
      notes.push(`claude in ${w.cwd}: no session id and ${idlessPerCwd.get(w.cwd)} candidates — plain shell`);
      return { cwd: w.cwd };
    }
    if (w.kind === "command" && w.command?.length) return { cwd: w.cwd, cmd: shellEscape(w.command) };
    return { cwd: w.cwd };
  };

  const windows: RestoreOsWindow[] = m.osWindows.map((osw, i) => ({
    // Keeping profile app_ids (ws-<name>-*) intact preserves the workspace
    // launcher's already-running detection across reboots.
    appId: osw.appId !== "kitty" ? osw.appId : `session-${i}`,
    workspace: osw.workspace,
    tabs: osw.tabs.map((t) => ({
      title: t.title ?? "shell",
      windows: t.windows.map(toSessionWindow),
    })),
  }));

  if (m.claudeUnmatched.length > 0) {
    claudeCount += m.claudeUnmatched.length;
    windows.push({
      appId: "session-claude",
      workspace: m.focusedWorkspace,
      tabs: m.claudeUnmatched.map((s) => ({
        title: s.name ?? "claude",
        windows: [{ cwd: s.cwd, cmd: `${s.command} --resume ${s.sessionId}` }],
      })),
    });
  }

  return { windows, claudeCount, notes };
}

export async function saveManifest(m: Manifest): Promise<string> {
  await mkdir(SESSION_DIR, { recursive: true });
  await Bun.write(MANIFEST_PATH, JSON.stringify(m, null, 2) + "\n");
  // Arm a fresh one-shot auto-restore for the next login. The manifest itself is
  // durable — only this token is consumed by login-restore — so a new save is
  // the only thing that replaces the snapshot.
  await Bun.write(AUTORESTORE_PATH, "");
  await rm(AUTORESTORE_CLAIM_PATH, { force: true }); // drop any stale in-flight claim
  return MANIFEST_PATH;
}

export function pendingManifest(): Manifest | null {
  if (!existsSync(MANIFEST_PATH)) return null;
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, "utf-8")) as Manifest;
  } catch {
    return null;
  }
}

/** True while a saved snapshot is still armed to auto-restore on the next login. */
export function autoRestoreArmed(): boolean {
  return existsSync(AUTORESTORE_PATH) || existsSync(AUTORESTORE_CLAIM_PATH);
}

/**
 * Atomically consume the one-shot auto-restore token so a login restore fires
 * exactly once per save, even across a crash or a racing invocation. The durable
 * manifest is left untouched — only the token is claimed. Returns null when
 * nothing is armed (never saved, or already auto-restored this cycle).
 */
export async function claimAutoRestore(): Promise<{ manifest: Manifest; claimedToken: string } | null> {
  const manifest = pendingManifest();
  if (!manifest) return null;
  try {
    await rename(AUTORESTORE_PATH, AUTORESTORE_CLAIM_PATH);
  } catch {
    return null; // not armed, or another restore raced us
  }
  return { manifest, claimedToken: AUTORESTORE_CLAIM_PATH };
}

/** Drop the claimed auto-restore token after a login restore. Manifest stays. */
export async function discardAutoRestore(claimedToken: string): Promise<void> {
  await rm(claimedToken, { force: true });
}

/** Disarm the one-shot login trigger without touching the durable manifest. */
export async function disarmAutoRestore(): Promise<void> {
  await rm(AUTORESTORE_PATH, { force: true });
  await rm(AUTORESTORE_CLAIM_PATH, { force: true });
}

/** Drop the snapshot and its trigger entirely (explicit `clear`). */
export async function clearSnapshot(): Promise<void> {
  await rm(MANIFEST_PATH, { force: true });
  await disarmAutoRestore();
}
