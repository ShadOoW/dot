import { defineCommand } from "citty";
import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { isCancel, select } from "@clack/prompts";
import { colors, logError, logInfo, logSuccess, logWarn } from "../../lib/console.ts";
import { findWindows, getScreenText, sendKeys, sendText, type TermWindow } from "../../lib/kitty.ts";
import { run } from "../../lib/spawn.ts";
import {
  JOBS_DIR,
  deleteJob,
  describePayload,
  jobFile,
  loadJob,
  runnerAlive,
  saveJob,
  type CueJob,
} from "./runner.ts";

/**
 * Cue a kitty window: paste text and/or press keys, now or on a schedule.
 *
 * With no timing flag it fires immediately at the window for the current repo —
 * the dispatch half of the nvim review loop (review.nvim exports annotations to
 * the clipboard, <leader>rs pipes them here, the agent gets them as its next
 * prompt):
 *
 *   echo "fix the error handling in api.ts" | dot cue
 *   dot cue --text "..." --no-enter
 *   dot cue --keys enter                  # window holds the text, just submit
 *
 * With --in/--at/--auto it schedules the same injection for later via a
 * detached runner — built to wake a rate-limited claude session back up, but
 * any window is a valid target:
 *
 *   dot cue --in 4h --text "continue"
 *   dot cue --at 3am --keys enter
 *   dot cue --auto                        # claude: read reset time off the banner
 *   dot cue --list | --cancel <id>
 */

const RUNNER_PATH = join(import.meta.dir, "runner.ts");
const PRUNE_AFTER_MS = 48 * 60 * 60 * 1000;

// ─── time parsing ─────────────────────────────────────────────────────────────

/** "4h", "90m", "4h30m", "45s" → ms. Null on anything else. */
export function parseDuration(input: string): number | null {
  const re = /(\d+)\s*([hms])/g;
  let ms = 0;
  let matched = "";
  for (const m of input.matchAll(re)) {
    const n = parseInt(m[1], 10);
    ms += n * (m[2] === "h" ? 3_600_000 : m[2] === "m" ? 60_000 : 1000);
    matched += m[0];
  }
  if (ms === 0 || matched.replace(/\s/g, "") !== input.replace(/\s/g, "")) return null;
  return ms;
}

/** "03:15", "3:15am", "15:00" → epoch ms of the next occurrence. */
export function parseAt(input: string): number | null {
  const m = input.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const meridiem = m[3]?.toLowerCase();
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "pm" && hour !== 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
  } else if (hour > 23) {
    return null;
  }
  const at = new Date();
  at.setHours(hour, minute, 0, 0);
  if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1);
  return at.getTime();
}

function formatRemaining(ms: number): string {
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return h > 0 ? `${h}h ${min}m` : min > 0 ? `${min}m` : `${Math.round(ms / 1000)}s`;
}

// ─── payload ──────────────────────────────────────────────────────────────────

interface Payload {
  text: string | null;
  keys: string[];
}

/** "enter", "down,enter", "ctrl+c enter" → ["ctrl+c", "enter"]. Null on empty/garbage. */
export function parseKeys(input: string): string[] | null {
  const keys = input
    .split(/[,\s]+/)
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
  return keys.length > 0 ? keys : null;
}

// ─── window resolution ────────────────────────────────────────────────────────

async function gitRoot(): Promise<string> {
  const r = await run(["git", "rev-parse", "--show-toplevel"]);
  return r.exitCode === 0 ? r.stdout.trim() : process.cwd();
}

function windowLabel(w: TermWindow): string {
  const pid = w.socket.replace(/^unix:\/tmp\/kitty-/, "");
  return `${w.title || "(untitled)"} — ${w.cwd} [${w.app ?? "shell"}] (kitty ${pid})${w.isSelf ? " (this window)" : ""}`;
}

/**
 * Send-now target. A --match that uniquely identifies a window wins outright;
 * otherwise the window for the current repo is picked, with app windows
 * outranking bare shell prompts. Never targets the window this command was
 * spawned from — an agent piping to `cue` must not prompt itself into a loop.
 */
async function resolveRepoWindow(match?: string): Promise<TermWindow | null> {
  const others = (await findWindows(match)).filter((w) => !w.isSelf);
  if (match && others.length === 1) return others[0]!;
  const root = await gitRoot();
  let candidates = others.filter((w) => w.cwd === root);
  if (candidates.length === 0) {
    candidates = others.filter((w) => w.cwd.startsWith(`${root}/`) || root.startsWith(`${w.cwd}/`));
  }
  if (candidates.length > 1) {
    const apps = candidates.filter((w) => w.app != null);
    if (apps.length > 0) candidates = apps;
  }
  if (candidates.length === 0) {
    logError(`No kitty window found for ${root}`);
    return null;
  }
  if (candidates.length > 1) {
    logWarn(`Multiple windows match ${root} — narrow it down with --match <title|cwd|app substring>:`);
    for (const w of candidates) logWarn(`  ${windowLabel(w)}`);
    return null;
  }
  return candidates[0]!;
}

/**
 * Schedule target: any window (the rate-limited one is often the window you're
 * scheduling from, so isSelf is kept and merely warned about).
 */
async function resolveScheduledWindow(match?: string): Promise<TermWindow | null> {
  const windows = await findWindows(match);
  if (windows.length === 0) {
    logError(match ? `No kitty window matches "${match}"` : "No kitty window found");
    return null;
  }
  if (windows.length === 1) {
    logInfo(`Target: ${windowLabel(windows[0])}`);
    return windows[0];
  }
  if (!process.stdin.isTTY) {
    logError(`${windows.length} windows found — narrow with --match <title|cwd|app substring>:`);
    for (const w of windows) logInfo(windowLabel(w));
    return null;
  }
  const picked = await select({
    message: "Multiple windows — which one?",
    options: windows.map((w, i) => ({ value: i, label: windowLabel(w) })),
  });
  if (isCancel(picked)) return null;
  return windows[picked as number];
}

// ─── --auto: parse the rate-limit banner ─────────────────────────────────────

async function parseResetFromScreen(win: TermWindow): Promise<number | null> {
  const screen = await getScreenText(win.socket, win.windowId);
  if (!screen) {
    logError("Could not read the target window's screen text");
    return null;
  }
  // Tolerant to wording drift: "Your limit will reset at 3am", "resets 6:30pm", …
  const re = /reset(?:s)?(?:\s+at)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/gi;
  let last: RegExpExecArray | null = null;
  for (const m of screen.matchAll(re)) last = m;
  if (!last) {
    const tail = screen.trim().split("\n").slice(-6).join("\n");
    logError("No rate-limit reset time found on screen. Use --in 4h or --at <time>.");
    logInfo(`Screen tail:\n${colors.dim(tail)}`);
    return null;
  }
  const timeStr = `${last[1]}${last[2] ? `:${last[2]}` : ""}${last[3] ?? ""}`;
  const fireAt = parseAt(timeStr);
  if (!fireAt) {
    logError(`Found "${last[0]}" but could not parse "${timeStr}" as a time`);
    return null;
  }
  logInfo(`Parsed reset time ${new Date(fireAt).toLocaleTimeString()} from banner: "${last[0].trim()}" (+3 min buffer)`);
  return fireAt + 3 * 60_000;
}

// ─── job listing / cancelling ─────────────────────────────────────────────────

function effectiveStatus(job: CueJob): string {
  if (job.status === "pending" && !runnerAlive(job)) return "stale";
  return job.status;
}

async function loadAllJobs(): Promise<CueJob[]> {
  if (!existsSync(JOBS_DIR)) return [];
  const jobs: CueJob[] = [];
  for (const entry of readdirSync(JOBS_DIR)) {
    if (!entry.endsWith(".json")) continue;
    const job = loadJob(join(JOBS_DIR, entry));
    if (job) jobs.push(job);
  }
  return jobs.sort((a, b) => a.fireAt - b.fireAt);
}

async function listJobs(): Promise<void> {
  const jobs = await loadAllJobs();
  const keep: CueJob[] = [];
  for (const job of jobs) {
    const status = effectiveStatus(job);
    const age = Date.now() - (job.firedAt ?? job.createdAt);
    if (status !== "pending" && age > PRUNE_AFTER_MS) {
      await deleteJob(job);
      continue;
    }
    keep.push(job);
  }
  if (keep.length === 0) {
    logInfo("No scheduled cues.");
    return;
  }
  console.log("");
  for (const job of keep) {
    const status = effectiveStatus(job);
    const color = status === "pending" ? colors.green : status === "fired" ? colors.dim : status === "stale" ? colors.yellow : colors.red;
    const when = new Date(job.fireAt).toLocaleString();
    const rel = job.fireAt > Date.now() ? ` (in ${formatRemaining(job.fireAt - Date.now())})` : "";
    const staleHint = status === "stale" ? " — runner dead (reboot?)" : "";
    console.log(`  ${colors.bold(job.id)}  ${color(status)}${staleHint}`);
    console.log(`    ${colors.dim(`fires ${when}${rel} · ${describePayload(job)} → ${job.windowTitle || job.cwd}`)}`);
  }
  console.log("");
}

async function cancelJob(id: string | undefined): Promise<boolean> {
  const pending = (await loadAllJobs()).filter((j) => effectiveStatus(j) === "pending");
  let job: CueJob | undefined;
  if (id) {
    job = pending.find((j) => j.id === id);
    if (!job) {
      logError(`No pending job "${id}" (see --list)`);
      return false;
    }
  } else if (pending.length === 0) {
    logInfo("Nothing to cancel.");
    return true;
  } else if (pending.length === 1) {
    job = pending[0];
  } else {
    const picked = await select({
      message: "Cancel which job?",
      options: pending.map((j, i) => ({ value: i, label: `${j.id} — fires ${new Date(j.fireAt).toLocaleString()} (${describePayload(j)})` })),
    });
    if (isCancel(picked)) return false;
    job = pending[picked as number];
  }

  if (job.runnerPid && runnerAlive(job)) {
    try {
      process.kill(job.runnerPid, "SIGTERM");
    } catch {}
  }
  job.status = "cancelled";
  await saveJob(job);
  logSuccess(`Cancelled ${job.id}`);
  return true;
}

// ─── command ─────────────────────────────────────────────────────────────────

export const cueCommand = defineCommand({
  meta: {
    name: "cue",
    description: "Paste text and/or press keys in a kitty window, now or scheduled with --in/--at/--auto",
  },
  args: {
    text: { type: "string", description: "Text to paste (default: stdin when piped)" },
    keys: { type: "string", description: 'Keys to press after the text, comma/space separated (e.g. "enter", "down,enter", "ctrl+c")' },
    match: { type: "string", description: "Filter target window by title/cwd/app substring" },
    enter: {
      type: "boolean",
      default: true,
      description: "Press Enter after the text (disable with --no-enter)",
      negativeDescription: "Paste text without submitting it",
    },
    in: { type: "string", description: "Schedule: delay before firing (e.g. 4h, 90m, 4h30m)" },
    at: { type: "string", description: "Schedule: wall-clock time to fire (e.g. 03:15, 3:15am)" },
    auto: { type: "boolean", description: "Schedule: read the reset time from claude's rate-limit banner on screen" },
    list: { type: "boolean", description: "List scheduled cues" },
    cancel: { type: "boolean", description: "Cancel a scheduled cue (id as positional, or pick)" },
    "dry-run": { type: "boolean", description: "Resolve target and fire time, print the plan, change nothing" },
  },
  async run({ args }) {
    if (args.list) {
      await listJobs();
      return;
    }
    if (args.cancel) {
      process.exit((await cancelJob((args._ ?? [])[0])) ? 0 : 1);
    }

    const modeCount = [args.in, args.at, args.auto ? "auto" : undefined].filter(Boolean).length;
    if (modeCount > 1) {
      logError("Use only one of --in, --at, --auto");
      process.exit(1);
    }

    let explicitKeys: string[] | null = null;
    if (args.keys) {
      explicitKeys = parseKeys(args.keys);
      if (!explicitKeys) {
        logError(`Invalid --keys "${args.keys}" (e.g. "enter", "down,enter", "ctrl+c")`);
        process.exit(1);
      }
    }

    /** Text + explicit keys → payload; text alone gets Enter unless --no-enter. */
    const buildPayload = (text: string | null): Payload => ({
      text,
      keys: explicitKeys ?? (text != null && args.enter !== false ? ["enter"] : []),
    });

    // ── fire now ──────────────────────────────────────────────────────────────
    if (modeCount === 0) {
      // Only fall back to stdin for text when there is something piped in —
      // `dot cue --keys enter` from a TTY must not block on stdin.
      const stdinText = args.text == null && !process.stdin.isTTY ? await Bun.stdin.text() : "";
      const text = (args.text ?? stdinText).trimEnd() || null;
      const payload = buildPayload(text);
      if (payload.text == null && payload.keys.length === 0) {
        logError("Nothing to send (no --text, --keys, or piped stdin)");
        process.exit(1);
      }
      const target = await resolveRepoWindow(args.match);
      if (!target) process.exit(1);

      if (payload.text != null) {
        if (!(await sendText(target.socket, target.windowId, payload.text))) {
          logError("kitten send-text failed");
          process.exit(1);
        }
        // Let the TUI ingest the paste before the key events so they aren't
        // coalesced into it (same trick as the scheduled runner).
        if (payload.keys.length > 0) await Bun.sleep(400);
      }
      if (payload.keys.length > 0 && !(await sendKeys(target.socket, target.windowId, payload.keys))) {
        logError(payload.text != null ? "kitten send-key failed — text pasted but keys not sent" : "kitten send-key failed");
        process.exit(1);
      }
      logSuccess(`Sent ${describePayload(payload)} to ${target.title || target.cwd}`);
      return;
    }

    // ── schedule ────────────────────────────────────────────────────────────────
    const target = await resolveScheduledWindow(args.match);
    if (!target) process.exit(1);

    let fireAt: number | null = null;
    if (args.in) {
      const ms = parseDuration(args.in);
      if (!ms || ms < 10_000) {
        logError(`Invalid --in "${args.in}" (min 10s; e.g. 4h, 90m, 4h30m)`);
        process.exit(1);
      }
      fireAt = Date.now() + ms;
    } else if (args.at) {
      fireAt = parseAt(args.at);
      if (!fireAt) {
        logError(`Invalid --at "${args.at}" (e.g. 03:15, 3:15am)`);
        process.exit(1);
      }
    } else {
      fireAt = await parseResetFromScreen(target);
      if (!fireAt) process.exit(1);
    }

    let payload = buildPayload(args.text?.trimEnd() || null);
    if (payload.text == null && payload.keys.length === 0) {
      // Claude windows keep the old wake-up default; anything else needs an
      // explicit payload — typing "continue" into a random shell is not it.
      if (target.app !== "claude") {
        logError("Nothing to send — give --text and/or --keys (e.g. --keys enter)");
        process.exit(1);
      }
      payload = { text: "continue", keys: ["enter"] };
      logInfo('No payload given — defaulting to "continue" + enter for the claude window');
    }

    const job: CueJob = {
      id: Date.now().toString(36),
      createdAt: Date.now(),
      fireAt,
      socket: target.socket,
      windowId: target.windowId,
      windowTitle: target.title,
      cwd: target.cwd,
      app: target.app,
      text: payload.text,
      keys: payload.keys,
      runnerPid: null,
      status: "pending",
    };

    const when = `${new Date(fireAt).toLocaleString()} (in ${formatRemaining(fireAt - Date.now())})`;
    if (args["dry-run"]) {
      logInfo(`Would send ${describePayload(job)} at ${when} via:`);
      if (job.text != null) {
        console.log(colors.dim(`    kitten @ --to ${job.socket} send-text --match id:${job.windowId} -- ${job.text}`));
      }
      if (job.keys.length > 0) {
        console.log(colors.dim(`    kitten @ --to ${job.socket} send-key --match id:${job.windowId} ${job.keys.join(" ")}`));
      }
      return;
    }

    await saveJob(job);
    const proc = Bun.spawn(["setsid", process.execPath, RUNNER_PATH, jobFile(job.id)], {
      stdio: ["ignore", "ignore", "ignore"],
      env: process.env,
    });
    proc.unref();

    // The runner records its own PID into the job file on startup; give it a
    // beat so an immediate --list shows a live runner.
    await Bun.sleep(150);
    if (target.isSelf) {
      logWarn("Target is this window — the scheduled payload will land in this session.");
    }
    logSuccess(`Scheduled ${job.id}: ${describePayload(job)} → ${target.title || target.cwd} at ${when}`);
    logInfo(`Manage with: dot cue --list | --cancel ${job.id}`);
  },
});
