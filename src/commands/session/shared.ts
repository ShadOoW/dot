import { liveSessionIds } from "../../lib/agents.ts";
import { colors, logError, logInfo, logWarn } from "../../lib/console.ts";
import {
  appVerdict,
  orphanVerdict,
  restoreContext,
  windowVerdict,
  type AgentRef,
  type Manifest,
  type ManifestApp,
  type ManifestWindow,
} from "../../lib/session.ts";
import {
  enumerateWindows,
  formatRow,
  matchesSelector,
  parseSelector,
  pickWindows,
  selectManifest,
  selectorForRefs,
  type SelectableWindow,
} from "../../lib/session-select.ts";

// Selection is resolved identically for every verb — save, restore, reboot and
// recover all narrow the same way — so the rule a user learns once holds
// everywhere: --only narrows the picker, --all skips it.

export interface SelectArgs {
  all?: boolean;
  only?: string;
  except?: string;
}

const SELECTOR_HELP = "terms: all, agent, agent:<launcher>, command, shell, app";

/**
 * Rows for the picker, each carrying the verdict a restore would actually
 * produce. The verdict is dispatched on the ref prefix because that is the only
 * thing distinguishing the three manifest sections at this seam.
 *
 * `liveIds` is the duplicate-resume guard and belongs to RESTORE only. At save
 * time every session in the manifest is running by definition — that is what
 * makes it worth saving — so passing it there would mark the entire picker
 * "already running" and unrestorable.
 */
export function selectable(m: Manifest, liveIds: Set<string> = new Set()): SelectableWindow[] {
  const ctx = restoreContext(m, liveIds);
  return enumerateWindows(m, (w, ref) =>
    ref.startsWith("app.")
      ? appVerdict(w as ManifestApp)
      : ref.startsWith("orphan.")
        ? orphanVerdict(w as AgentRef & { cwd: string }, ctx)
        : windowVerdict(w as ManifestWindow, ctx),
  );
}

export interface Selection {
  manifest: Manifest;
  /** Canonical selector for this selection, or null when it is everything. */
  selector: string | null;
}

export async function resolveSelection(
  m: Manifest,
  args: SelectArgs,
  message: string,
  liveIds?: Set<string>,
): Promise<Selection | null> {
  const all = selectable(m, liveIds);
  if (all.length === 0) {
    logWarn("nothing open to select");
    return null;
  }

  let pool = all;
  for (const flag of ["only", "except"] as const) {
    const raw = args[flag];
    if (!raw) continue;
    const sel = parseSelector(raw);
    if (!sel) {
      logError(`unparseable --${flag} "${raw}" — ${SELECTOR_HELP}`);
      process.exit(1);
    }
    const invert = flag === "except";
    pool = pool.filter((w) => matchesSelector(w, sel) !== invert);
  }
  if (pool.length === 0) {
    logWarn(`selector matched nothing — ${SELECTOR_HELP}`);
    return null;
  }

  if (args.all) {
    const refs = new Set(pool.map((w) => w.ref));
    return { manifest: selectManifest(m, refs), selector: selectorForRefs(all, refs) };
  }

  const picked = await pickWindows(pool, message);
  if (!picked) {
    // pickWindows declines to prompt without a TTY, exactly as `dot cue` does.
    // Print the rows and the flag that would have selected them, so a scripted
    // caller is told how to proceed instead of silently getting nothing.
    if (!process.stdin.isTTY) {
      logError("not a terminal — pass --all, or --only <selector>:");
      for (const w of pool) console.log(`  ${formatRow(w)}`);
    }
    return null;
  }
  if (picked.size === 0) {
    logWarn("nothing selected");
    return null;
  }
  return { manifest: selectManifest(m, picked), selector: selectorForRefs(all, picked) };
}

export function summarize(m: Manifest, liveIds?: Set<string>): void {
  const rows = selectable(m, liveIds);
  const tally = new Map<string, number>();
  for (const r of rows) tally.set(r.group, (tally.get(r.group) ?? 0) + 1);
  logInfo(
    [...tally]
      .map(([g, n]) => `${colors.bold(String(n))} ${g}`)
      .join(colors.dim(" · ")) || "empty",
  );
  for (const r of rows) console.log(`  ${formatRow(r)}`);
  const stuck = rows.filter((r) => !r.restorable);
  if (stuck.length > 0) logWarn(`${stuck.length} window(s) cannot be restored — see the rows marked above`);
}
