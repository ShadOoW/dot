import { defineCommand } from "citty";
import { crashVictims, type TranscriptRecord } from "../../lib/agents.ts";
import { colors, logInfo, logWarn } from "../../lib/console.ts";
import { notify } from "../../lib/kitty.ts";
import type { Manifest } from "../../lib/session.ts";
import { runRestore } from "./restore.ts";
import { resolveSelection, summarize } from "./shared.ts";

// Recovery after an UNPLANNED shutdown, with no daemon and no state of our own.
//
// Nothing was saved — that is what makes it unplanned — but the transcripts are still on
// disk, so the sessions themselves are all still resumable. The only thing missing is the
// knowledge of WHICH ones were open, and no signal on disk answers that: a transcript's
// mtime is its last activity, so an open-but-idle session is indistinguishable from one
// closed days ago.
//
// So this does not pretend to know. It offers what predates this boot, most recent first,
// and a human picks. Guessing narrowly was the earlier mistake: cutting off 15 minutes
// before boot silently hid anything left idle, and hiding a session costs the session
// while offering a stale one costs an unticked row.
//
// Deliberately NOT auto-restored on login. After a crash you rarely want the
// whole desktop back before you have looked at it, and an automatic rebuild
// would race whatever you do first. The login hook only notifies; recovery is
// one command you run when you want it.

const DEFAULT_LIMIT = 25;

/**
 * Window the login notification uses. Narrow on purpose: it fires on every boot, so it
 * must only speak when something plausibly went down mid-session rather than listing
 * every session you have ever had.
 */
const NOTIFY_WINDOW_MIN = 15;

/**
 * Victims as a manifest of windowless agents, so recovery reuses the ordinary
 * pipeline — same picker, same verdicts, same restore — instead of growing a
 * parallel one.
 */
function victimManifest(victims: TranscriptRecord[]): Manifest {
  return {
    version: 2,
    savedAt: Date.now(),
    focusedWorkspace: null,
    osWindows: [],
    apps: [],
    layout: null,
    agentsOrphaned: victims.map((v) => ({
      agent: v.agent,
      command: v.command,
      sessionId: v.sessionId,
      cwd: v.cwd,
    })),
    skipped: { scratchpad: [] },
  };
}

export const recoverCommand = defineCommand({
  meta: { description: "Resume agent sessions from before this boot" },
  args: {
    all: { type: "boolean", description: "Skip the picker and resume every candidate" },
    only: { type: "string", description: "Narrow to a selector, e.g. agent:omp" },
    except: { type: "string", description: "Drop matching sessions" },
    within: { type: "string", description: "Only sessions active within N minutes before the boot" },
    limit: { type: "string", description: `Most recent N candidates (default ${DEFAULT_LIMIT})` },
    notify: { type: "boolean", description: "Login hook: notify if anything is recoverable, then exit silently" },
    "dry-run": { type: "boolean", description: "List the candidates without resuming anything" },
  },
  async run({ args }) {
    // The two callers want opposite things from the same evidence.
    //
    // Interactive: be generous. Default to everything before this boot, newest first,
    // because hiding a session costs the session while offering a stale one costs an
    // unticked row — and you are picking from a list either way.
    //
    // --notify: be narrow. It runs on EVERY login, so a generous list would mean a popup
    // every single boot. Only sessions active shortly before the machine stopped are
    // suggestive enough to interrupt for, so that path keeps a tight window unless one
    // is given explicitly.
    let withinMs: number | undefined = args.notify ? NOTIFY_WINDOW_MIN * 60_000 : undefined;
    if (args.within != null) {
      const minutes = Number(args.within);
      if (!Number.isFinite(minutes) || minutes <= 0) {
        logWarn(`--within must be a positive number of minutes, got "${args.within}"`);
        return;
      }
      withinMs = minutes * 60_000;
    }
    let limit = DEFAULT_LIMIT;
    if (args.limit != null) {
      const n = Number(args.limit);
      if (!Number.isInteger(n) || n <= 0) {
        logWarn(`--limit must be a positive whole number, got "${args.limit}"`);
        return;
      }
      limit = n;
    }
    const victims = crashVictims(withinMs, limit);

    if (victims.length === 0) {
      // Silence is required on the login path: this runs on every boot.
      if (!args.notify) logInfo("No agent sessions found from before this boot");
      return;
    }

    if (args.notify) {
      // Never claims the shutdown was unclean: mtimes cannot establish that, and the sway
      // hook only reaches this point when nothing was restored, which is suggestive but
      // not proof. Report the evidence, name the command, stop there.
      const what = `${victims.length} agent session(s) were active just before this boot`;
      notify("normal", "Sessions recoverable", `${what} — run \`dot session recover\``);
      return;
    }

    const manifest = victimManifest(victims);
    logInfo(
      `${colors.bold(String(victims.length))} agent session(s) from before this boot, most recent first` +
        colors.dim(" — narrow with --within <minutes>"),
    );

    if (args["dry-run"]) {
      summarize(manifest);
      return;
    }

    const chosen = await resolveSelection(manifest, args, "Resume which agent sessions?");
    if (!chosen) return;
    await runRestore(chosen.manifest);
  },
});
