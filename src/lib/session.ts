import { readFileSync } from "fs";
import { agentById, agentForCmdline, liveAgentSessions, type LiveAgentSession } from "./agents.ts";
import { logWarn } from "./console.ts";
import { listOsWindows, liveSockets, primaryProc, socketPid, type KittyFgProcess } from "./kitty.ts";
import { captureLayout, type LayoutSnapshot } from "./sway-layout.ts";
import { getTree, walkTree, type SwayNode } from "./sway.ts";
import { shellEscape } from "./spawn.ts";
import type { SessionTab, SessionWindow } from "./kitty-session.ts";

// What is open right now, as data: every kitty window's cwd and foreground
// command, the coding-agent session behind it, the GUI windows beside it, and
// the sway container shape holding all of it. Capture is always TOTAL — the
// selector layer (session-select.ts) narrows afterwards, and persistence lives
// in session-slots.ts. Keeping capture unfiltered means one code path and no
// information destroyed at the only moment it is still available.

// Pre-warmed scratchpad kitties from the sway exec block — recreated on every
// login, so restoring them would duplicate them.
const SCRATCHPAD_APP_IDS: Record<string, true> = { "terminal-mark": true, "music-mark": true, "yazi-explorer": true };

export type WindowKind = "agent" | "command" | "shell";

/** Resolved coding agent occupying a window. `command` is the account-bearing launcher. */
export interface AgentRef {
  agent: string;
  command: string;
  sessionId: string | null;
  name?: string;
}

export interface ManifestWindow {
  cwd: string;
  title?: string;
  kind: WindowKind;
  command?: string[] | null;
  agent?: AgentRef | null;
}

export interface ManifestTab {
  title?: string;
  windows: ManifestWindow[];
}

export interface ManifestOsWindow {
  kittyPid: number | null;
  appId: string;
  /**
   * sway con_id at capture time. Every bare kitty os-window reports the same
   * app_id, so this is the only thing that tells six agent terminals apart —
   * it is what lets the layout snapshot be matched up on restore.
   */
  conId: number | null;
  workspace: number | null;
  tabs: ManifestTab[];
}

/**
 * A non-kitty GUI window. argv is read from /proc/<pid>/cmdline at capture time,
 * which is the only moment it exists — sway reports an app_id and nothing else.
 *
 * appId is nullable because an xwayland window has no app_id and may have no
 * window class either. Inventing a key from the title would produce something
 * sway can never resolve, so such a window is recorded and reported as
 * unrestorable rather than silently mis-addressed.
 */
export interface ManifestApp {
  appId: string | null;
  /** sway con_id at capture time; the layout snapshot refers to windows by it. */
  conId: number | null;
  workspace: number | null;
  argv: string[] | null;
}

export interface Manifest {
  version: 2;
  savedAt: number;
  focusedWorkspace: number | null;
  osWindows: ManifestOsWindow[];
  apps: ManifestApp[];
  layout: LayoutSnapshot | null;
  agentsOrphaned: Array<AgentRef & { cwd: string }>;
  skipped: { scratchpad: string[] };
}

/**
 * A kitty window's foreground_processes holds the whole process group — for an
 * agent window that is the wrapper, the agent, and its MCP servers at once. An
 * agent wins outright (its pid is what joins to a live session); otherwise the
 * lowest-pid non-noise process is the user-invoked parent (npm, bun, nvim, …).
 */
export function classifyWindow(fg: KittyFgProcess[] | undefined): {
  kind: WindowKind;
  command?: string[];
  agentPid?: number;
  agentId?: string;
} {
  const proc = primaryProc(fg);
  if (!proc) return { kind: "shell" };
  const adapter = agentForCmdline(proc.cmdline!);
  if (adapter) return { kind: "agent", agentPid: proc.pid, agentId: adapter.id };
  return { kind: "command", command: proc.cmdline };
}

interface Leaf {
  node: SwayNode;
  workspace: SwayNode | null;
}

/**
 * Sway leaf for a kitty os-window.
 *
 * Keyed on wm_class, which is the app_id the os-window was created with — the
 * same string sway reports. PID cannot be the primary key now that kitty runs
 * --single-instance: every os-window shares one pid, so a pid filter matched
 * all of them and fell back to an active-title guess (the "workspace mapping
 * may be off" warning). PID stays as the fallback for an os-window that has no
 * wm_class, and title as the tiebreak between several windows sharing the
 * default `kitty` app_id.
 */
function swayLeafFor(
  leaves: Leaf[],
  wmClass: string | undefined,
  pid: number | null,
  activeTitle: string | undefined,
  used: Set<number>,
): Leaf | null {
  const mine = leaves.filter(
    (l) => !used.has(l.node.id) && (wmClass ? l.node.app_id === wmClass : l.node.pid === pid),
  );
  if (mine.length === 0) return null;
  if (mine.length > 1) {
    const byTitle = mine.find((l) => activeTitle && l.node.name === activeTitle);
    if (byTitle) return byTitle;
  }
  return mine[0]!;
}

function argvOf(pid: number | undefined): string[] | null {
  if (pid == null) return null;
  try {
    const argv = readFileSync(`/proc/${pid}/cmdline`, "utf-8").split("\0").filter(Boolean);
    return argv.length > 0 ? argv : null;
  } catch {
    return null; // gone, or not ours to read
  }
}

/**
 * Join a window to a live agent session, in descending order of certainty: the
 * agent's own pid, then the kitty socket + window id it registered from, then a
 * cwd that only one session of that agent claims. Anything less would risk
 * resuming the wrong conversation, so it stays unresolved instead.
 */
function matchAgentSession(
  sessions: LiveAgentSession[],
  used: Set<number>,
  agentId: string | undefined,
  agentPid: number | undefined,
  socket: string,
  windowId: number,
  cwd: string,
): LiveAgentSession | null {
  const pool = sessions.filter((s) => !used.has(s.pid) && (agentId == null || s.agent === agentId));
  const byPid = agentPid != null ? pool.find((s) => s.pid === agentPid) : undefined;
  if (byPid) return byPid;
  const bySocket = pool.find((s) => s.kittySocket === socket && s.kittyWindowId === windowId);
  if (bySocket) return bySocket;
  const byCwd = pool.filter((s) => s.cwd === cwd);
  return byCwd.length === 1 ? byCwd[0]! : null;
}

export async function captureManifest(): Promise<Manifest> {
  const sockets = liveSockets();
  const tree = await getTree();
  const leaves = [...walkTree(tree)];
  const sessions = liveAgentSessions();
  const focused = leaves.find((l) => l.node.focused);

  const kittyPids = new Set<number>();
  const usedLeaves = new Set<number>();
  const matched = new Set<number>();
  const osWindows: ManifestOsWindow[] = [];
  const scratchpad: string[] = [];

  for (const socket of sockets) {
    const pid = socketPid(socket);
    if (pid != null) kittyPids.add(pid);
    const ls = await listOsWindows(socket);
    if (!ls) continue;

    for (const osw of ls) {
      const activeTab = osw.tabs?.find((t) => t.is_focused) ?? osw.tabs?.[0];
      const activeWin = activeTab?.windows?.find((w) => w.is_focused) ?? activeTab?.windows?.[0];
      const leaf = swayLeafFor(leaves, osw.wm_class, pid, activeWin?.title, usedLeaves);
      if (leaf) usedLeaves.add(leaf.node.id);
      const appId = leaf?.node.app_id ?? osw.wm_class ?? "kitty";
      if (SCRATCHPAD_APP_IDS[appId] || leaf?.workspace?.name === "__i3_scratch") {
        scratchpad.push(appId);
        continue;
      }

      const tabs: ManifestTab[] = [];
      for (const tab of osw.tabs ?? []) {
        const windows: ManifestWindow[] = [];
        for (const win of tab.windows ?? []) {
          const cwd = win.cwd ?? win.foreground_processes?.[0]?.cwd ?? process.env.HOME!;
          const { kind, command, agentPid, agentId } = classifyWindow(win.foreground_processes);
          let agent: AgentRef | null = null;
          if (kind === "agent") {
            const match = matchAgentSession(sessions, matched, agentId, agentPid, socket, win.id, cwd);
            if (match) matched.add(match.pid);
            // Launcher: the matched session knows its account; failing that ask
            // the adapter to read it off the process; failing that the bare id.
            const adapter = agentId ? agentById(agentId) : null;
            const command =
              match?.command ?? (agentPid != null ? adapter?.commandForPid(agentPid) : null) ?? agentId ?? "claude";
            agent = { agent: match?.agent ?? agentId ?? "claude", command, sessionId: match?.sessionId ?? null };
            if (match?.name) agent.name = match.name;
          }
          windows.push({ cwd, title: win.title, kind, command: command ?? null, agent });
        }
        if (windows.length > 0) tabs.push({ title: tab.title, windows });
      }
      if (tabs.length > 0) {
        osWindows.push({
          kittyPid: pid,
          appId,
          conId: leaf?.node.id ?? null,
          workspace: leaf?.workspace?.num ?? null,
          tabs,
        });
      }
    }
  }

  const apps = leaves
    .filter((l) => l.node.pid != null && !kittyPids.has(l.node.pid) && l.workspace?.name !== "__i3_scratch")
    .map((l) => ({
      appId: l.node.app_id ?? l.node.window_properties?.class ?? null,
      conId: l.node.id,
      workspace: l.workspace?.num ?? null,
      argv: argvOf(l.node.pid),
    }));

  return {
    version: 2,
    savedAt: Date.now(),
    focusedWorkspace: focused?.workspace?.num ?? null,
    osWindows,
    apps,
    layout: captureLayout(tree),
    agentsOrphaned: sessions
      .filter((s) => !matched.has(s.pid))
      .map((s) => ({ agent: s.agent, command: s.command, sessionId: s.sessionId, name: s.name, cwd: s.cwd })),
    skipped: { scratchpad },
  };
}

export interface RestoreOsWindow {
  appId: string;
  /** Capture-time con_id this window stands in for, for the layout pass. */
  conId: number | null;
  workspace: number | null;
  tabs: SessionTab[];
}

export interface RestorePlan {
  windows: RestoreOsWindow[];
  apps: ManifestApp[];
  agentCount: number;
  notes: string[];
}

/**
 * Everything `buildRestorePlan` needs that is not in the manifest, hoisted so
 * the picker can show the same verdict a restore would produce — deciding what
 * to keep is worth nothing if the consequence only appears afterwards.
 */
export interface RestoreContext {
  /** How many id-less windows of one agent share a cwd, keyed `<agent>\0<cwd>`. */
  idless: Map<string, number>;
  /** Session ids already running: resuming them a second time would corrupt one transcript with two writers. */
  liveIds: Set<string>;
}

const idlessKey = (agent: string, cwd: string): string => `${agent}\0${cwd}`;

export function restoreContext(m: Manifest, liveIds: Set<string> = new Set()): RestoreContext {
  const idless = new Map<string, number>();
  for (const osw of m.osWindows) {
    for (const tab of osw.tabs) {
      for (const w of tab.windows) {
        if (w.kind !== "agent" || w.agent?.sessionId) continue;
        const key = idlessKey(w.agent?.agent ?? "?", w.cwd);
        idless.set(key, (idless.get(key) ?? 0) + 1);
      }
    }
  }
  return { idless, liveIds };
}

export function windowVerdict(w: ManifestWindow, ctx: RestoreContext): { verdict: string; restorable: boolean } {
  if (w.kind === "agent") {
    const ref = w.agent;
    if (ref?.sessionId) {
      if (ctx.liveIds.has(ref.sessionId)) {
        return { verdict: "already running — skipped", restorable: false };
      }
      // Full id, so the row's verdict column collapses as redundant against the
      // detail column rather than repeating a truncated copy of it.
      return { verdict: `resume ${ref.sessionId}`, restorable: true };
    }
    const key = idlessKey(ref?.agent ?? "?", w.cwd);
    if (ctx.idless.get(key) === 1) return { verdict: "continue newest — no id", restorable: true };
    return { verdict: `plain shell — ${ctx.idless.get(key) ?? 0} id-less here`, restorable: false };
  }
  if (w.kind === "command") {
    return w.command?.length ? { verdict: "re-run", restorable: true } : { verdict: "plain shell", restorable: true };
  }
  return { verdict: "reopen at cwd", restorable: true };
}

export function appVerdict(a: ManifestApp): { verdict: string; restorable: boolean } {
  if (!a.appId) return { verdict: "no app_id — sway cannot address it", restorable: false };
  return a.argv?.length
    ? { verdict: "exec argv", restorable: true }
    : { verdict: "no argv captured — cannot relaunch", restorable: false };
}

export function orphanVerdict(
  o: AgentRef & { cwd: string },
  ctx: RestoreContext,
): { verdict: string; restorable: boolean } {
  if (o.sessionId && ctx.liveIds.has(o.sessionId)) {
    return { verdict: "already running — skipped", restorable: false };
  }
  return { verdict: `resume ${o.sessionId ?? "?"}`, restorable: true };
}

export function buildRestorePlan(m: Manifest, liveIds: Set<string> = new Set()): RestorePlan {
  const ctx = restoreContext(m, liveIds);
  const notes: string[] = [];
  let agentCount = 0;

  /**
   * null means "do not open a window for this at all". Reserved for a session that
   * is already running: putting an empty terminal on screen for a conversation you
   * can already see is pure litter, and it is what made a repeat restore leave a
   * trail of blank windows. An UNRESOLVED id is different — you did ask for a
   * terminal in that directory — so that still degrades to a plain shell.
   */
  const toSessionWindow = (w: ManifestWindow): SessionWindow | null => {
    if (w.kind === "agent") {
      const ref = w.agent;
      const { restorable } = windowVerdict(w, ctx);
      if (!restorable) {
        if (ref?.sessionId) {
          notes.push(`${ref.command} ${ref.sessionId.slice(0, 8)} is already running — no window opened`);
          return null;
        }
        notes.push(`${ref?.command ?? "agent"} in ${w.cwd}: no session id and several candidates — plain shell`);
        return { cwd: w.cwd };
      }
      const adapter = ref ? agentById(ref.agent) : null;
      const argv = ref?.sessionId
        ? adapter?.resumeArgv(ref.command, ref.sessionId)
        : adapter?.continueArgv(ref!.command);
      if (!argv) {
        notes.push(`no adapter for agent "${ref?.agent}" — ${w.cwd} restored as a plain shell`);
        return { cwd: w.cwd };
      }
      agentCount++;
      return { cwd: w.cwd, cmd: shellEscape(argv) };
    }
    if (w.kind === "command" && w.command?.length) return { cwd: w.cwd, cmd: shellEscape(w.command) };
    return { cwd: w.cwd };
  };

  // Prune bottom-up: a tab whose every window was omitted is not a tab, and an
  // os-window with no tabs left must not be launched empty. This is what makes a
  // second restore of an untouched slot a genuine no-op.
  const windows: RestoreOsWindow[] = m.osWindows
    .map((osw, i) => ({
      // Keeping a profile-shaped app_id intact preserves the already-running
      // detection that layout rebuild relies on across reboots.
      appId: osw.appId !== "kitty" ? osw.appId : `session-${i}`,
      conId: osw.conId,
      workspace: osw.workspace,
      tabs: osw.tabs
        .map((t) => ({
          title: t.title ?? "shell",
          windows: t.windows.map(toSessionWindow).filter((w): w is SessionWindow => w !== null),
        }))
        .filter((t) => t.windows.length > 0),
    }))
    .filter((osw) => osw.tabs.length > 0);

  const orphans = m.agentsOrphaned.filter((o) => orphanVerdict(o, ctx).restorable && o.sessionId);
  if (orphans.length > 0) {
    agentCount += orphans.length;
    windows.push({
      appId: "session-agents",
      // Never existed at capture time, so no layout slot refers to it.
      conId: null,
      workspace: m.focusedWorkspace,
      tabs: orphans.map((o) => {
        const adapter = agentById(o.agent);
        const argv = adapter?.resumeArgv(o.command, o.sessionId!) ?? [o.command, "--resume", o.sessionId!];
        return { title: o.name ?? o.agent, windows: [{ cwd: o.cwd, cmd: shellEscape(argv) }] };
      }),
    });
  }

  return { windows, apps: m.apps.filter((a) => appVerdict(a).restorable), agentCount, notes };
}
