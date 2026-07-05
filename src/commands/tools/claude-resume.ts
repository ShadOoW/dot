import { defineCommand } from "citty";
import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { isCancel, select, text } from "@clack/prompts";
import { colors, logError, logInfo, logSuccess, logWarn } from "../../lib/console.ts";
import { findClaudeWindows, getScreenText, type ClaudeWindow } from "../../lib/kitty.ts";
import {
  JOBS_DIR,
  deleteJob,
  jobFile,
  loadJob,
  runnerAlive,
  saveJob,
  type ResumeJob,
} from "./claude-resume-runner.ts";

const RUNNER_PATH = join(import.meta.dir, "claude-resume-runner.ts");
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

function windowLabel(w: ClaudeWindow): string {
  const pid = w.socket.replace(/^unix:\/tmp\/kitty-/, "");
  return `${w.title || "(untitled)"} — ${w.cwd} (kitty ${pid})${w.isSelf ? " (this window)" : ""}`;
}

async function resolveWindow(match?: string): Promise<ClaudeWindow | null> {
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
    message: "Multiple claude sessions — which one should be resumed?",
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
    logInfo("No scheduled resumes.");
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

export const claudeResumeCommand = defineCommand({
  meta: { description: "Resume a rate-limited claude session later by injecting a prompt into its kitty window" },
  args: {
    in: { type: "string", description: "Delay before injecting (e.g. 4h, 90m, 4h30m)" },
    at: { type: "string", description: "Wall-clock time to inject (e.g. 03:15, 3:15am)" },
    auto: { type: "boolean", description: "Read the reset time from the rate-limit banner on screen" },
    text: { type: "string", default: "continue", description: "Prompt text to inject" },
    match: { type: "string", description: "Filter target window by title/cwd substring" },
    list: { type: "boolean", description: "List scheduled resumes" },
    cancel: { type: "boolean", description: "Cancel a scheduled resume (id as positional, or pick)" },
    "dry-run": { type: "boolean", description: "Resolve window and fire time, print the plan, change nothing" },
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

    const target = await resolveWindow(args.match);
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
    } else if (args.auto) {
      fireAt = await parseResetFromScreen(target);
      if (!fireAt) process.exit(1);
    } else {
      if (!process.stdin.isTTY) {
        logError("No --in/--at/--auto given and not a TTY");
        process.exit(1);
      }
      const answer = await text({
        message: "When? (duration like 4h30m, or time like 3:15am)",
        placeholder: "4h",
      });
      if (isCancel(answer) || !answer) process.exit(1);
      const ms = parseDuration(answer);
      fireAt = ms && ms >= 10_000 ? Date.now() + ms : parseAt(answer);
      if (!fireAt) {
        logError(`Could not parse "${answer}"`);
        process.exit(1);
      }
    }

    const job: ResumeJob = {
      id: Date.now().toString(36),
      createdAt: Date.now(),
      fireAt,
      socket: target.socket,
      windowId: target.windowId,
      windowTitle: target.title,
      cwd: target.cwd,
      text: args.text,
      runnerPid: null,
      status: "pending",
    };

    const when = `${new Date(fireAt).toLocaleString()} (in ${formatRemaining(fireAt - Date.now())})`;
    if (args["dry-run"]) {
      logInfo(`Would inject "${job.text}" at ${when} via:`);
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
      logWarn("Target is this window — the injected text will land in this session.");
    }
    logSuccess(`Scheduled ${job.id}: "${job.text}" → ${target.title || target.cwd} at ${when}`);
    logInfo(`Manage with: dot tools claude-resume --list | --cancel ${job.id}`);
  },
});
