import { groupMultiselect, isCancel } from "@clack/prompts";
import { colors } from "./console.ts";
import { shortenPath } from "./ghosts.ts";
import type { AgentRef, Manifest, ManifestApp, ManifestWindow, WindowKind } from "./session.ts";

// Which windows a session verb acts on. save, restore, reboot and recover all
// narrow the same manifest, so the narrowing lives here once: a pure filter
// driven by the --only/--except grammar, and one picker that expresses
// "everything", "by type" and "individual windows" without ever asking the user
// which mode they are in.
//
// Restore verdicts are rendered here but computed elsewhere and passed in as a
// callback. That seam is the reason this file imports no restore logic, no
// kitty and no sway: the tests build manifests by hand and hand in a stub, so
// the selection rules are checkable without a live desktop.

/**
 * Positional key for one window in a manifest — `os.tab.window`, `app.<i>` or
 * `orphan.<i>`. Derived from array indices, so a ref is only meaningful against
 * the manifest it was enumerated from; the picker and the filter always share
 * that one manifest.
 */
export type WindowRef = string;

export interface SelectableWindow {
  ref: WindowRef;
  kind: WindowKind | "app";
  /** The launcher (`AgentRef.command`) for agents, null otherwise. Never the adapter id. */
  flavour: string | null;
  group: string;
  cwd: string;
  /** What occupies the window: resume id, argv, or "shell". */
  detail: string;
  /** What restore will actually do with it. */
  verdict: string;
  restorable: boolean;
}

export interface Selector {
  terms: Array<{ kind: string; flavour: string | null }>;
}

/**
 * Supplies the restore verdict for one manifest node. Backed by buildRestorePlan
 * at the call site; kept as a parameter so this module never depends on it.
 */
export type VerdictFn = (
  w: ManifestWindow | ManifestApp | (AgentRef & { cwd: string }),
  ref: WindowRef,
) => { verdict: string; restorable: boolean };

const SELECTABLE_KINDS: Record<string, true> = { agent: true, command: true, shell: true, app: true };
const ORPHAN_GROUP = "agent (no window)";

// ─── selector strings ────────────────────────────────────────────────────────

/** Parse an --only/--except value. Returns null for anything the grammar rejects. */
export function parseSelector(input: string): Selector | null {
  const terms: Selector["terms"] = [];
  for (const raw of input.split(",")) {
    const term = raw.trim();
    if (term.length === 0) continue;
    const parts = term.split(":");
    if (parts.length > 2) return null;
    const kind = parts[0]!.trim().toLowerCase();
    const flavour = parts.length === 2 ? parts[1]!.trim() : null;
    if (kind !== "all" && SELECTABLE_KINDS[kind] !== true) return null;
    // Only agents have flavours, and a bare `agent:` names nothing.
    if (flavour !== null && (kind !== "agent" || flavour.length === 0)) return null;
    terms.push({ kind, flavour });
  }
  return terms.length > 0 ? { terms } : null;
}

export function matchesSelector(w: SelectableWindow, sel: Selector): boolean {
  return sel.terms.some((t) => {
    if (t.kind === "all") return true;
    if (t.kind !== w.kind) return false;
    return t.flavour === null || t.flavour === w.flavour;
  });
}

// ─── enumeration ─────────────────────────────────────────────────────────────

function agentDetail(a: AgentRef | null | undefined): string {
  if (!a) return "(no agent)";
  return a.sessionId ?? "(no session id)";
}

/**
 * Every selectable thing in the manifest, in a fixed order: terminal windows
 * (os-window, tab, window), then GUI apps, then live agents with no window.
 */
export function enumerateWindows(m: Manifest, verdict: VerdictFn): SelectableWindow[] {
  const out: SelectableWindow[] = [];

  m.osWindows.forEach((osw, oi) => {
    osw.tabs.forEach((tab, ti) => {
      tab.windows.forEach((w, wi) => {
        const ref = `${oi}.${ti}.${wi}`;
        const flavour = w.kind === "agent" ? (w.agent?.command ?? null) : null;
        const detail =
          w.kind === "agent"
            ? agentDetail(w.agent)
            : w.kind === "command"
              ? (w.command?.join(" ") ?? "(no command)")
              : "shell";
        out.push({
          ref,
          kind: w.kind,
          flavour,
          // A kind-"agent" window with no AgentRef is a capture failure, not a
          // flavour; it gets the bare group so it stays visible and selectable.
          group: w.kind === "agent" ? (flavour === null ? "agent" : `agent:${flavour}`) : w.kind,
          cwd: w.cwd,
          detail,
          ...verdict(w, ref),
        });
      });
    });
  });

  m.apps.forEach((app, i) => {
    const ref = `app.${i}`;
    out.push({
      ref,
      kind: "app",
      flavour: null,
      group: "app",
      // A GUI window has no captured cwd; its app_id is what identifies it, and
      // shortenPath leaves a non-path untouched, so the column still lines up.
      // An xwayland window may have no app_id at all, and is labelled as such
      // rather than shown as a blank row.
      cwd: app.appId ?? "(no app_id)",
      detail: app.argv?.join(" ") ?? "(no argv)",
      ...verdict(app, ref),
    });
  });

  m.agentsOrphaned.forEach((a, i) => {
    const ref = `orphan.${i}`;
    out.push({
      ref,
      kind: "agent",
      flavour: a.command,
      group: ORPHAN_GROUP,
      cwd: a.cwd,
      detail: agentDetail(a),
      ...verdict(a, ref),
    });
  });

  return out;
}

// ─── pure narrowing ──────────────────────────────────────────────────────────

/**
 * A copy of the manifest holding only the referenced windows. Tabs emptied by
 * the filter are dropped, then os-windows left with no tabs — restoring an
 * empty kitty window is worse than restoring nothing. Everything else
 * (version, savedAt, focusedWorkspace, layout, skipped) passes through.
 */
export function selectManifest(m: Manifest, refs: Set<WindowRef>): Manifest {
  const osWindows = m.osWindows
    .map((osw, oi) => ({
      ...osw,
      tabs: osw.tabs
        .map((tab, ti) => ({ ...tab, windows: tab.windows.filter((_, wi) => refs.has(`${oi}.${ti}.${wi}`)) }))
        .filter((tab) => tab.windows.length > 0),
    }))
    .filter((osw) => osw.tabs.length > 0);

  return {
    ...m,
    osWindows,
    apps: m.apps.filter((_, i) => refs.has(`app.${i}`)),
    agentsOrphaned: m.agentsOrphaned.filter((_, i) => refs.has(`orphan.${i}`)),
  };
}

const KIND_ORDER = ["agent", "command", "shell", "app"];

function bucketKey(w: SelectableWindow): string | null {
  if (w.kind !== "agent") return w.kind;
  // An agent whose launcher is unknown has no term that names it.
  return w.flavour === null ? null : `agent:${w.flavour}`;
}

/**
 * The --only string that would reproduce this selection, or null when there is
 * nothing worth printing: the selection is total (the default), empty, or made
 * of half-selected groups that no term can express. Interactive verbs print
 * this back so the picker teaches the flag.
 */
export function selectorForRefs(all: SelectableWindow[], refs: Set<WindowRef>): string | null {
  const buckets = new Map<string, { total: number; picked: number }>();
  let picked = 0;
  for (const w of all) {
    const hit = refs.has(w.ref);
    if (hit) picked++;
    const key = bucketKey(w);
    if (key === null) {
      if (hit) return null;
      continue;
    }
    const b = buckets.get(key) ?? { total: 0, picked: 0 };
    b.total++;
    if (hit) b.picked++;
    buckets.set(key, b);
  }
  if (picked === all.length) return null;

  const terms: string[] = [];
  for (const [key, b] of buckets) {
    if (b.picked === 0) continue;
    if (b.picked < b.total) return null;
    terms.push(key);
  }
  if (terms.length === 0) return null;

  terms.sort((a, b) => {
    const ra = KIND_ORDER.indexOf(a.split(":")[0]!);
    const rb = KIND_ORDER.indexOf(b.split(":")[0]!);
    return ra === rb ? a.localeCompare(b) : ra - rb;
  });
  return terms.join(",");
}

// ─── rows ────────────────────────────────────────────────────────────────────

// A clack group child is printed as `│  │ ◻ <label>` — seven columns of chrome
// before the row starts. 2 + 24 + 1 + 30 + 1 + 2 + 28 = 88 keeps the whole line
// inside an 80-plus-a-bit terminal and always inside 100.
const CWD_WIDTH = 24;
const DETAIL_WIDTH = 30;
const VERDICT_WIDTH = 28;

function padTail(s: string, n: number): string {
  // Paths are identified by their tail, so a long cwd loses its head.
  return s.length > n ? `…${s.slice(s.length - n + 1)}` : s.padEnd(n);
}

function padHead(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n);
}

/** One picker row: where, what is in it, and what restore will do if that differs. */
export function formatRow(w: SelectableWindow): string {
  const mark = w.restorable ? "  " : `${colors.red("!")} `;
  const cwd = colors.cyan(padTail(shortenPath(w.cwd), CWD_WIDTH));
  // The verdict is only news when it says something the detail does not — a
  // command that re-runs verbatim or an agent that resumes its own id is noise.
  const redundant = w.verdict.length === 0 || (w.detail.length > 0 && w.verdict.includes(w.detail));
  const verdict = redundant ? "" : colors.dim(`→ ${padHead(w.verdict, VERDICT_WIDTH)}`);
  return `${mark}${cwd} ${padHead(w.detail, DETAIL_WIDTH)} ${verdict}`.trimEnd();
}

/**
 * The one selection widget. A clack group header is itself a selectable row and
 * space on it toggles every child, so type-level and window-level picking are
 * the same gesture and there is no mode to ask about.
 *
 * Everything starts selected except the app group, making the picker
 * subtraction rather than construction: Enter means "all of it". Apps are
 * opt-in because relaunching arbitrary GUI argv is the one thing here that can
 * do something the user did not ask for.
 *
 * Returns null when cancelled or when there is no terminal to prompt on — the
 * caller then prints the list plus the equivalent --only string, exactly as
 * `cue` degrades when it cannot disambiguate a window.
 */
export async function pickWindows(all: SelectableWindow[], message: string): Promise<Set<WindowRef> | null> {
  // clack renders an empty prompt as an unanswerable one, and "nothing to pick"
  // is a selection of nothing, not a failure to prompt.
  if (all.length === 0) return new Set();
  if (!process.stdin.isTTY) return null;

  const options: Record<string, Array<{ value: WindowRef; label: string }>> = {};
  for (const w of all) (options[w.group] ??= []).push({ value: w.ref, label: formatRow(w) });

  const picked = await groupMultiselect<WindowRef>({
    message,
    options,
    initialValues: all.filter((w) => w.kind !== "app").map((w) => w.ref),
  });
  if (isCancel(picked)) return null;
  return new Set(picked);
}
