import { defineCommand } from "citty";
import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { isCancel, select } from "@clack/prompts";
import { colors, logError, logInfo, logSuccess, logWarn } from "../../lib/console.ts";
import { findClaudeWindows, getScreenText, sendEnter, sendText, type ClaudeWindow } from "../../lib/kitty.ts";
import { run } from "../../lib/spawn.ts";
import {
  JOBS_DIR,
  deleteJob,
  jobFile,
  loadJob,
  runnerAlive,
  saveJob,
  type ResumeJob,
} from "./send-runner.ts";

/**
 * Send text into the Claude Code session running in a kitty window.
 *
 * With no timing flag it fires immediately at this repo's window — the dispatch
 * half of the nvim review loop (review.nvim exports annotations to the
 * clipboard, <leader>rs pipes them here, the agent gets them as its next
 * prompt):
 *
 *   echo "fix the error handling in api.ts" | dot claude send
 *   dot claude send --text "..." --no-enter
 *
 * With --in/--at/--auto it schedules the same injection for later via a
 * detached runner — built to wake a rate-limited session back up:
 *
 *   dot claude send --in 4h --text "continue"
 *   dot claude send --auto          # read the reset time off the banner
 *   dot claude send --list | --cancel <id>
 */

const RUNNER_PATH = join(import.meta.dir, "send-runner.ts");
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

// ─── window resolution ────────────────────────────────────────────────────────

async function gitRoot(): Promise<string> {
  const r = await run(["git", "rev-parse", "--show-toplevel"]);
  return r.exitCode === 0 ? r.stdout.trim() : process.cwd();
}

function windowLabel(w: ClaudeWindow): string {
  const pid = w.socket.replace(/^unix:\/tmp\/kitty-/, "");
  return `${w.title || "(untitled)"} — ${w.cwd} (kitty ${pid})${w.isSelf ? " (this window)" : ""}`;
}

/**
 * Send-now target: the claude window for the current repo. Never targets the
 * window this command was spawned from — an agent piping to `send` must not
 * prompt itself into a loop.
 */
async function resolveRepoWindow(match?: string): Promise<ClaudeWindow | null> {
  const root = await gitRoot();
  const others = (await findClaudeWindows(match)).filter((w) => !w.isSelf);
  let candidates = others.filter((w) => w.cwd === root);
  if (candidates.length === 0) {
    candidates = others.filter((w) => w.cwd.startsWith(`${root}/`) || root.startsWith(`${w.cwd}/`));
  }
  if (candidates.length === 0) {
    logError(`No Claude Code window found for ${root}`);
    return null;
  }
  if (candidates.length > 1) {
    logWarn(`Multiple Claude windows match ${root} — narrow it down with --match:`);
    for (const w of candidates) logWarn(`  ${w.cwd}  (${w.title})`);
    return null;
  }
  return candidates[0]!;
}

/**
 * Schedule target: any claude window (the rate-limited one is often the window
 * you're scheduling from, so isSelf is kept and merely warned about).
 */
async function resolveScheduledWindow(match?: string): Promise<ClaudeWindow | null> {
  const windows = await findClaudeWindows(match);
  if (windows.length === 0) {
    logError(match ? `No kitty window with a claude session matches "${match}"` : "No kitty window with a running claude session found");
    return null;
  }
  if (windows.length === 1) {
    logInfo(`Target: ${windowLabel(windows[0])}`);
    return windows[0];
  }
  if (!process.stdin.isTTY) {
    logError(`${windows.length} claude sessions found — narrow with --match <title|cwd substring>:`);
    for (const w of windows) logInfo(windowLabel(w));
    return null;
  }
  const picked = await select({
    message: "Multiple claude sessions — which one?",
    options: windows.map((w, i) => ({ value: i, label: windowLabel(w) })),
  });
  if (isCancel(picked)) return null;
  return windows[picked as number];
}

// ─── --auto: parse the rate-limit banner ─────────────────────────────────────

async function parseResetFromScreen(win: ClaudeWindow): Promise<number | null> {
  const screen = await getScreenText(win.socket, win.windowId);
  if (!screen) {
    logError("Could not read the claude window's screen text");
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

function effectiveStatus(job: ResumeJob): string {
  if (job.status === "pending" && !runnerAlive(job)) return "stale";
  return job.status;
}

async function loadAllJobs(): Promise<ResumeJob[]> {
  if (!existsSync(JOBS_DIR)) return [];
  const jobs: ResumeJob[] = [];
  for (const entry of readdirSync(JOBS_DIR)) {
    if (!entry.endsWith(".json")) continue;
    const job = loadJob(join(JOBS_DIR, entry));
    if (job) jobs.push(job);
  }
  return jobs.sort((a, b) => a.fireAt - b.fireAt);
}

async function listJobs(): Promise<void> {
  const jobs = await loadAllJobs();
  const keep: ResumeJob[] = [];
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
    logInfo("No scheduled sends.");
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
    console.log(`    ${colors.dim(`fires ${when}${rel} · "${job.text}" → ${job.windowTitle || job.cwd}`)}`);
  }
  console.log("");
}

async function cancelJob(id: string | undefined): Promise<boolean> {
  const pending = (await loadAllJobs()).filter((j) => effectiveStatus(j) === "pending");
  let job: ResumeJob | undefined;
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
      options: pending.map((j, i) => ({ value: i, label: `${j.id} — fires ${new Date(j.fireAt).toLocaleString()} ("${j.text}")` })),
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

export const sendCommand = defineCommand({
  meta: {
    name: "send",
    description: "Send text to a claude kitty window now, or schedule it with --in/--at/--auto",
  },
  args: {
    text: { type: "string", description: 'Text to send (default: stdin when sending now, "continue" when scheduling)' },
    match: { type: "string", description: "Filter target window by title/cwd substring" },
    "no-enter": { type: "boolean", description: "Paste without submitting (send-now only)" },
    in: { type: "string", description: "Schedule: delay before sending (e.g. 4h, 90m, 4h30m)" },
    at: { type: "string", description: "Schedule: wall-clock time to send (e.g. 03:15, 3:15am)" },
    auto: { type: "boolean", description: "Schedule: read the reset time from the rate-limit banner on screen" },
    list: { type: "boolean", description: "List scheduled sends" },
    cancel: { type: "boolean", description: "Cancel a scheduled send (id as positional, or pick)" },
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

    // ── send now ──────────────────────────────────────────────────────────────
    if (modeCount === 0) {
      const text = (args.text ?? (await Bun.stdin.text())).trimEnd();
      if (!text) {
        logError("Nothing to send (empty stdin and no --text)");
        process.exit(1);
      }
      const target = await resolveRepoWindow(args.match);
      if (!target) process.exit(1);

      const sent = await sendText(target.socket, target.windowId, text);
      if (!sent) {
        logError("kitten send-text failed");
        process.exit(1);
      }
      if (!args["no-enter"]) {
        // Let the TUI ingest the paste before the key event so Enter isn't
        // coalesced into it (same trick as the scheduled runner).
        await Bun.sleep(400);
        if (!(await sendEnter(target.socket, target.windowId))) {
          logError("kitten send-key failed — text pasted but not submitted");
          process.exit(1);
        }
      }
      logSuccess(`Sent ${text.length} chars to ${target.title || target.cwd}`);
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

    const text = args.text ?? "continue";
    const job: ResumeJob = {
      id: Date.now().toString(36),
      createdAt: Date.now(),
      fireAt,
      socket: target.socket,
      windowId: target.windowId,
      windowTitle: target.title,
      cwd: target.cwd,
      text,
      runnerPid: null,
      status: "pending",
    };

    const when = `${new Date(fireAt).toLocaleString()} (in ${formatRemaining(fireAt - Date.now())})`;
    if (args["dry-run"]) {
      logInfo(`Would send "${job.text}" at ${when} via:`);
      console.log(colors.dim(`    kitten @ --to ${job.socket} send-text --match id:${job.windowId} -- ${job.text}`));
      console.log(colors.dim(`    kitten @ --to ${job.socket} send-key --match id:${job.windowId} enter`));
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
      logWarn("Target is this window — the scheduled text will land in this session.");
    }
    logSuccess(`Scheduled ${job.id}: "${job.text}" → ${target.title || target.cwd} at ${when}`);
    logInfo(`Manage with: dot claude send --list | --cancel ${job.id}`);
  },
});
