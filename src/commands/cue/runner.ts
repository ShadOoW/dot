import { existsSync, readFileSync } from "fs";
import { mkdir, rename, unlink, writeFile } from "fs/promises";
import { join } from "path";
import { CACHE_DIR } from "../../lib/config.ts";
import { findWindows, notify, sendKeys, sendText } from "../../lib/kitty.ts";

// Detached runner for a scheduled `dot cue --in/--at/--auto`. Executed
// directly (`setsid bun runner.ts <job.json>`), never via citty; the
// scheduling command imports only the job helpers below (import.meta.main
// keeps the runner body from executing on import).

export type JobStatus = "pending" | "fired" | "failed" | "cancelled";

export interface CueJob {
  id: string;
  createdAt: number;
  fireAt: number;
  socket: string;
  windowId: number;
  windowTitle: string;
  cwd: string;
  /** App the target window was running at schedule time (retarget hint). */
  app: string | null;
  /** Text to paste; null = keys-only job. */
  text: string | null;
  /** Keys pressed after the text (kitty send-key names: enter, tab, ctrl+c, …). */
  keys: string[];
  runnerPid: number | null;
  status: JobStatus;
  error?: string;
  firedAt?: number;
}

export const JOBS_DIR = join(CACHE_DIR, "cue-jobs");

export function jobFile(id: string): string {
  return join(JOBS_DIR, `${id}.json`);
}

/** Human label for a job's payload: `"continue" + enter`, `keys: enter`, … */
export function describePayload(job: Pick<CueJob, "text" | "keys">): string {
  if (job.text == null) return `keys: ${job.keys.join(" ")}`;
  return job.keys.length > 0 ? `"${job.text}" + ${job.keys.join(" ")}` : `"${job.text}"`;
}

export async function saveJob(job: CueJob): Promise<void> {
  await mkdir(JOBS_DIR, { recursive: true });
  const path = jobFile(job.id);
  // Per-PID tmp name: the canceller and the runner's SIGTERM handler can save
  // concurrently, and a shared tmp file would let one rename steal the other's
  // source out from under it.
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(job, null, 2));
  await rename(tmp, path);
}

export function loadJob(path: string): CueJob | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as CueJob;
  } catch {
    return null;
  }
}

/** Is the job's runner still this job's runner? Guards PID reuse after reboot. */
export function runnerAlive(job: CueJob): boolean {
  if (!job.runnerPid) return false;
  try {
    const cmdline = readFileSync(`/proc/${job.runnerPid}/cmdline`, "utf-8");
    return cmdline.includes(jobFile(job.id));
  } catch {
    return false;
  }
}

export async function deleteJob(job: CueJob): Promise<void> {
  await unlink(jobFile(job.id)).catch(() => {});
}

async function runnerMain(): Promise<void> {
  const path = process.argv[2];
  if (!path || !existsSync(path)) process.exit(2);
  let job = loadJob(path);
  if (!job) process.exit(2);

  job.runnerPid = process.pid;
  job.status = "pending";
  await saveJob(job);

  process.on("SIGTERM", () => {
    void (async () => {
      const fresh = loadJob(path);
      if (fresh && fresh.status === "pending") {
        fresh.status = "cancelled";
        await saveJob(fresh);
      }
      process.exit(0);
    })();
  });

  // Suspend-safe wait: nanosleep pauses during suspend, so a single long
  // sleep would fire late by the entire suspend duration. Re-checking the
  // wall clock every <=60s bounds the drift, and re-reading the job file
  // gives --cancel a race-free second path besides SIGTERM.
  while (true) {
    const remaining = job.fireAt - Date.now();
    if (remaining <= 0) break;
    await Bun.sleep(Math.min(60_000, remaining));
    const fresh = loadJob(path);
    if (!fresh || fresh.status === "cancelled") process.exit(0);
    job = fresh;
  }

  const windows = await findWindows();
  let target = windows.find((w) => w.socket === job.socket && w.windowId === job.windowId);
  if (!target) {
    // Window or kitty instance gone — fall back to a window in the same
    // working directory (preferring the same app), but only if unambiguous.
    let candidates = windows.filter((w) => w.cwd === job.cwd);
    if (candidates.length > 1) {
      const sameApp = candidates.filter((w) => w.app === job.app);
      if (sameApp.length > 0) candidates = sameApp;
    }
    if (candidates.length === 1) target = candidates[0];
  }

  if (!target) {
    job.status = "failed";
    job.error = "no matching kitty window found at fire time";
    await saveJob(job);
    notify("critical", "Cue failed", `Job ${job.id}: target window not found (closed?)`);
    process.exit(1);
  }

  let ok = true;
  if (job.text != null) {
    ok = await sendText(target.socket, target.windowId, job.text);
    // Let the TUI ingest the text before the key events so they aren't
    // coalesced into the paste.
    if (ok && job.keys.length > 0) await Bun.sleep(400);
  }
  if (ok && job.keys.length > 0) {
    ok = await sendKeys(target.socket, target.windowId, job.keys);
  }

  job.status = ok ? "fired" : "failed";
  job.firedAt = Date.now();
  if (!ok) job.error = "kitten send-text/send-key failed";
  await saveJob(job);
  notify(
    ok ? "normal" : "critical",
    ok ? "Cue fired" : "Cue failed",
    ok ? `Sent ${describePayload(job)} to ${target.title || target.cwd}` : `Job ${job.id}: injection failed`,
  );
  process.exit(ok ? 0 : 1);
}

if (import.meta.main) {
  await runnerMain();
}
