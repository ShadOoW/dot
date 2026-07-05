import { existsSync, readFileSync } from "fs";
import { mkdir, rename, unlink, writeFile } from "fs/promises";
import { join } from "path";
import { CACHE_DIR } from "../../lib/config.ts";
import { findClaudeWindows, notify, sendEnter, sendText } from "../../lib/kitty.ts";

// Detached runner for `dot tools claude-resume`. Executed directly
// (`setsid bun claude-resume-runner.ts <job.json>`), never via citty; the
// scheduling command imports only the job helpers below (import.meta.main
// keeps the runner body from executing on import).

export type JobStatus = "pending" | "fired" | "failed" | "cancelled";

export interface ResumeJob {
  id: string;
  createdAt: number;
  fireAt: number;
  socket: string;
  windowId: number;
  windowTitle: string;
  cwd: string;
  text: string;
  runnerPid: number | null;
  status: JobStatus;
  error?: string;
  firedAt?: number;
}

export const JOBS_DIR = join(CACHE_DIR, "claude-resume");

export function jobFile(id: string): string {
  return join(JOBS_DIR, `${id}.json`);
}

export async function saveJob(job: ResumeJob): Promise<void> {
  await mkdir(JOBS_DIR, { recursive: true });
  const path = jobFile(job.id);
  // Per-PID tmp name: the canceller and the runner's SIGTERM handler can save
  // concurrently, and a shared tmp file would let one rename steal the other's
  // source out from under it.
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(job, null, 2));
  await rename(tmp, path);
}

export function loadJob(path: string): ResumeJob | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as ResumeJob;
  } catch {
    return null;
  }
}

/** Is the job's runner still this job's runner? Guards PID reuse after reboot. */
export function runnerAlive(job: ResumeJob): boolean {
  if (!job.runnerPid) return false;
  try {
    const cmdline = readFileSync(`/proc/${job.runnerPid}/cmdline`, "utf-8");
    return cmdline.includes(jobFile(job.id));
  } catch {
    return false;
  }
}

export async function deleteJob(job: ResumeJob): Promise<void> {
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

  const windows = await findClaudeWindows();
  let target = windows.find((w) => w.socket === job.socket && w.windowId === job.windowId);
  if (!target) {
    // Window or kitty instance gone — fall back to a claude session in the
    // same working directory, but only if it's unambiguous.
    const candidates = windows.filter((w) => w.cwd === job.cwd);
    if (candidates.length === 1) target = candidates[0];
  }

  if (!target) {
    job.status = "failed";
    job.error = "no claude window found at fire time";
    await saveJob(job);
    notify("critical", "Claude resume failed", `Job ${job.id}: no claude session found (window closed?)`);
    process.exit(1);
  }

  const sent = await sendText(target.socket, target.windowId, job.text);
  // Let the TUI ingest the text before the key event so Enter isn't coalesced
  // into the paste.
  await Bun.sleep(400);
  const ok = sent && (await sendEnter(target.socket, target.windowId));

  job.status = ok ? "fired" : "failed";
  job.firedAt = Date.now();
  if (!ok) job.error = "kitten send-text/send-key failed";
  await saveJob(job);
  notify(
    ok ? "normal" : "critical",
    ok ? "Claude resumed" : "Claude resume failed",
    ok ? `Sent "${job.text}" to ${target.title || target.cwd}` : `Job ${job.id}: injection failed`,
  );
  process.exit(ok ? 0 : 1);
}

if (import.meta.main) {
  await runnerMain();
}
