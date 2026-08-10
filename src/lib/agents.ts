import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, readlinkSync, statSync } from "fs";
import { basename, dirname, extname, join, resolve } from "path";
import { HOME_DIR } from "./config.ts";

// One adapter per coding-agent CLI. Everything the rest of the tool needs to know about
// an agent — how to recognise its process, how to find its live sessions, how to resume
// one, where its transcripts live — is a field in the AGENTS table, so teaching session
// capture and restore about a new agent is a data change instead of a hunt for every
// `=== "claude"` in the tree.
//
// ── Why detection scans the whole argv ──────────────────────────────────────────────
// The claude-only predecessor of this file let its callers test
// `basename(cmdline[0]) === "claude"`, which works purely by luck: ~/.bun/bin/claude is
// an ELF binary, so claude *is* argv[0]. Every other agent ships as a JS entrypoint and
// runs through its interpreter — measured on this host, every live omp is
// `bun /home/shad/.bun/bin/omp`, so argv[0] is `bun`. Under the argv[0] test such a
// window classified as a generic command and got "restored" by re-running that argv,
// which starts a FRESH agent with an empty context while reporting success: precisely
// the failure session restore exists to prevent. So matches() considers every argv
// element, the way kitty.ts already does for the headroom wrapper.

export interface LiveAgentSession {
  agent: string;
  pid: number;
  sessionId: string;
  cwd: string;
  name?: string;
  /** Launcher that resumes into this session's account (claude-work, omp, …). */
  command: string;
  /** KITTY_LISTEN_ON of the hosting kitty instance, when resolvable. */
  kittySocket?: string;
  /** KITTY_WINDOW_ID inside that instance, when resolvable. */
  kittyWindowId?: number;
}

export interface TranscriptRecord {
  agent: string;
  sessionId: string;
  cwd: string;
  command: string;
  mtimeMs: number;
}

export interface AgentAdapter {
  id: string;
  /** True when this foreground argv is this agent. */
  matches(cmdline: string[]): boolean;
  /** Launcher for a live pid, read from its environment; null when unresolvable. */
  commandForPid(pid: number): string | null;
  /** Live sessions, PID-keyed, stale entries excluded. */
  live(): LiveAgentSession[];
  resumeArgv(command: string, sessionId: string): string[];
  continueArgv(command: string): string[];
  /** Every session transcript on disk, for crash recovery. */
  transcripts(): TranscriptRecord[];
}

// ── /proc readers ───────────────────────────────────────────────────────────────────
// Every one of these degrades to null/[] rather than throwing: a pid can exit between
// the readdir and the read, and half of /proc belongs to other users.

/** starttime (field 22) from /proc/<pid>/stat; comm may contain spaces. */
function procStartTime(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
    const afterComm = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return afterComm[19] ?? null; // fields start at 3 → field 22 is index 19
  } catch {
    return null;
  }
}

function environOf(pid: number): Map<string, string> | null {
  try {
    const raw = readFileSync(`/proc/${pid}/environ`, "utf-8");
    const env = new Map<string, string>();
    for (const kv of raw.split("\0")) {
      const eq = kv.indexOf("=");
      if (eq > 0) env.set(kv.slice(0, eq), kv.slice(eq + 1));
    }
    return env;
  } catch {
    return null; // permissions — callers fall back to cwd matching
  }
}

/** Every pid visible to this user. */
function procPids(): number[] {
  const out: number[] = [];
  for (const entry of entriesOf("/proc")) {
    if (/^\d+$/.test(entry)) out.push(Number(entry));
  }
  return out;
}

function cmdlineOf(pid: number): string[] | null {
  try {
    const argv = readFileSync(`/proc/${pid}/cmdline`, "utf-8")
      .split("\0")
      .filter((a) => a.length > 0);
    return argv.length > 0 ? argv : null; // empty = kernel thread
  } catch {
    return null;
  }
}

/**
 * A process's working directory. Preferred over the transcript's project
 * directory name, which is a lossy flattening of the path.
 */
function procCwd(pid: number): string | null {
  try {
    return readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    return null; // exited, or another user's process
  }
}

function entriesOf(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return []; // absent (agent never installed) or unreadable
  }
}

function mtimeOf(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

// ── Detection ───────────────────────────────────────────────────────────────────────

/**
 * True when `cmdline` is running `name`. An element identifies the agent when its
 * basename is exactly the agent name AND it is either argv[0] (`claude …`) or a path
 * (`bun /home/shad/.bun/bin/omp` — the interpreter case this whole table exists for).
 * Both halves of that rule are load-bearing against false positives: a bare later word
 * is data, not an entrypoint, so `git commit -m omp` stays a plain command, and the
 * extension and flag guards keep `nvim src/omp.ts` and a hypothetical `--omp` out.
 * Misfiring here is expensive in both directions — a missed agent is restored as a
 * fresh context, a phantom agent is resumed into the wrong session.
 */
export function argvNamesAgent(cmdline: string[] | undefined, name: string): boolean {
  if (!cmdline?.length) return false;
  return cmdline.some((arg, i) => {
    if (arg.startsWith("-")) return false;
    if (extname(arg) !== "") return false;
    if (basename(arg) !== name) return false;
    return i === 0 || arg.includes("/");
  });
}

export function agentForCmdline(cmdline: string[]): AgentAdapter | null {
  return AGENTS.find((a) => a.matches(cmdline)) ?? null;
}

/** Adapter by id, for a manifest entry that already recorded which agent it was. */
export function agentById(id: string): AgentAdapter | null {
  return AGENTS.find((a) => a.id === id) ?? null;
}

// ── Transcripts ─────────────────────────────────────────────────────────────────────

// A transcript grows without bound (the largest on this host is tens of MB), and the
// only thing wanted from it is the cwd recorded near the top: claude puts it on its
// first `user` record, omp on its `session` header. So read a bounded prefix and stop.
// 64 KB clears both with room for one pasted mega-prompt ahead of them.
const TRANSCRIPT_PREFIX_BYTES = 64 * 1024;

// Both agents mint uuids for session ids. Requiring that shape is what keeps the
// siblings out: omp keeps a *directory* per session next to the .jsonl, and claude
// nests sidechain dirs inside a project dir, so an extension test alone is not enough.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Session id out of a transcript filename. claude names the file after the id
 * (`<uuid>.jsonl`); omp prefixes a sort key (`<timestamp>_<uuid>.jsonl`).
 */
export function sessionIdFromTranscript(file: string): string | null {
  if (!file.endsWith(".jsonl")) return null;
  const stem = file.slice(0, -".jsonl".length);
  const id = stem.slice(stem.lastIndexOf("_") + 1);
  return UUID.test(id) ? id : null;
}

/**
 * First cwd recorded in a jsonl prefix. The prefix is cut at a byte count, so its last
 * line is usually half a record — unparseable lines are simply not this one.
 */
export function cwdFromTranscriptPrefix(prefix: string): string | null {
  for (const line of prefix.split("\n")) {
    if (!line.includes('"cwd"')) continue;
    try {
      const rec = JSON.parse(line) as { cwd?: unknown };
      if (typeof rec.cwd === "string" && rec.cwd.startsWith("/")) return rec.cwd;
    } catch {
      continue;
    }
  }
  return null;
}

function readPrefix(path: string): string | null {
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const buf = Buffer.allocUnsafe(TRANSCRIPT_PREFIX_BYTES);
    const read = readSync(fd, buf, 0, buf.length, 0);
    return buf.toString("utf-8", 0, read);
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

// Cap the backtracking below. Nothing legitimate is 24 path segments deep, and the
// search is only reached for a transcript that recorded no cwd of its own.
const MAX_PATH_TOKENS = 24;

/**
 * Both agents name a project directory by flattening its path — claude writes
 * `-data-config` for /data/config, omp writes `--data-config-dot--` for
 * /data/config/dot — and the flattening is lossy: a dash in a real directory name is
 * indistinguishable from a separator. So the only way back is to walk the tokens
 * against the filesystem and let the disk arbitrate, which is why
 * `-data-code-work-bruce` resolves to /data/code/work-bruce (there is no
 * /data/code/work to descend into). Shortest segment first, so the answer is
 * deterministic when two candidates both exist.
 */
export function demangleProjectDir(dirName: string, exists: (p: string) => boolean = existsSync): string | null {
  const tokens = dirName.split("-").filter((t) => t.length > 0);
  if (tokens.length === 0 || tokens.length > MAX_PATH_TOKENS) return null;
  const walk = (prefix: string, from: number): string | null => {
    if (from === tokens.length) return prefix;
    for (let to = from + 1; to <= tokens.length; to++) {
      const next = `${prefix}/${tokens.slice(from, to).join("-")}`;
      if (!exists(next)) continue;
      const resolved = walk(next, to);
      if (resolved) return resolved;
    }
    return null;
  };
  return walk("", 0);
}

/** Recorded cwd, else the de-mangled directory name; null means "do not guess". */
function transcriptCwd(path: string, projectDir: string): string | null {
  const prefix = readPrefix(path);
  const recorded = prefix ? cwdFromTranscriptPrefix(prefix) : null;
  return recorded ?? demangleProjectDir(projectDir);
}

/** Every `<root>/<project>/<id>.jsonl` under a project-per-directory transcript root. */
function transcriptsUnder(root: string, agent: string, command: string): TranscriptRecord[] {
  const out: TranscriptRecord[] = [];
  for (const projectDir of entriesOf(root)) {
    for (const file of entriesOf(join(root, projectDir))) {
      const sessionId = sessionIdFromTranscript(file);
      if (!sessionId) continue;
      const path = join(root, projectDir, file);
      const mtimeMs = mtimeOf(path);
      if (mtimeMs == null) continue;
      const cwd = transcriptCwd(path, projectDir);
      if (!cwd) continue; // unresolvable cwd — a restored window would land in the wrong tree
      out.push({ agent, sessionId, cwd, command, mtimeMs });
    }
  }
  return out;
}

// ── claude ──────────────────────────────────────────────────────────────────────────

// Claude Code maintains a live registry of interactive sessions at
// <config-dir>/sessions/<pid>.json. Each account runs against its own
// CLAUDE_CONFIG_DIR (~/.claude-work, ~/.claude-personal), so the dir a session's
// registry file lives in identifies its account — and hence the wrapper that resumes
// it. ~/.claude is scanned too (bare-claude backup).

/**
 * Config dirs to scan, most specific first. Deduped by resolved path because
 * CLAUDE_CONFIG_DIR usually points at one of the defaults — without this, transcripts()
 * would report every file under it twice and crash recovery would offer each session
 * twice.
 */
function claudeConfigDirs(): string[] {
  const dirs = new Set<string>();
  if (process.env.CLAUDE_CONFIG_DIR) dirs.add(resolve(process.env.CLAUDE_CONFIG_DIR));
  dirs.add(join(HOME_DIR, ".claude-work"));
  dirs.add(join(HOME_DIR, ".claude-personal"));
  dirs.add(join(HOME_DIR, ".claude"));
  return [...dirs];
}

/**
 * Launcher that starts claude against a given CLAUDE_CONFIG_DIR. Each account has a
 * `claude-<account>` wrapper on PATH (packages/zsh/home/.local/bin) that pins
 * CLAUDE_CONFIG_DIR and applies headroom's setup; the bare ~/.claude config resumes
 * with plain `claude`. Unknown dirs fall back to bare claude.
 */
export function claudeCommandForConfigDir(configDir: string): string {
  const base = basename(configDir);
  if (base === ".claude") return "claude";
  const m = base.match(/^\.claude-(.+)$/);
  return m ? `claude-${m[1]}` : "claude";
}

interface RegistryEntry {
  pid?: number;
  sessionId?: string;
  cwd?: string;
  procStart?: string | number;
  kind?: string;
  name?: string;
}

/** Registry entries whose process is alive AND is the process that registered. */
function claudeLive(): LiveAgentSession[] {
  const seen = new Set<number>();
  const out: LiveAgentSession[] = [];
  for (const configDir of claudeConfigDirs()) {
    const dir = join(configDir, "sessions");
    for (const entry of entriesOf(dir)) {
      if (!entry.endsWith(".json")) continue;
      let reg: RegistryEntry;
      try {
        reg = JSON.parse(readFileSync(join(dir, entry), "utf-8"));
      } catch {
        continue;
      }
      if (!reg.pid || !reg.sessionId || !reg.cwd || seen.has(reg.pid)) continue;
      if (reg.kind && reg.kind !== "interactive") continue;
      const start = procStartTime(reg.pid);
      if (!start) continue; // process gone — stale entry
      if (reg.procStart != null && String(reg.procStart) !== start) continue; // PID reused
      seen.add(reg.pid);
      const env = environOf(reg.pid);
      const windowId = env?.get("KITTY_WINDOW_ID");
      out.push({
        agent: "claude",
        pid: reg.pid,
        sessionId: reg.sessionId,
        cwd: reg.cwd,
        name: reg.name,
        command: claudeCommandForConfigDir(configDir),
        kittySocket: env?.get("KITTY_LISTEN_ON"),
        kittyWindowId: windowId ? Number(windowId) : undefined,
      });
    }
  }
  return out;
}

// ── omp ─────────────────────────────────────────────────────────────────────────────

const OMP_SESSIONS_DIR = join(HOME_DIR, ".omp/agent/sessions");

/**
 * omp keeps no pid registry and — checked against a live process on this host — puts
 * nothing about the session in its environment, so the join runs through the kernel
 * instead: a live omp holds its transcript open, and the transcript path carries the
 * session uuid (`/proc/17590/fd/48 -> …/--data-config-dot--/<ts>_<uuid>.jsonl`). When
 * several session files are open at once the appended-to one is the live session, so
 * the newest mtime wins.
 */
function ompTranscriptOf(pid: number): string | null {
  let best: { path: string; mtimeMs: number } | null = null;
  for (const fd of entriesOf(`/proc/${pid}/fd`)) {
    let target: string;
    try {
      target = readlinkSync(`/proc/${pid}/fd/${fd}`);
    } catch {
      continue; // fd closed under us, or not ours to look at
    }
    if (!target.startsWith(`${OMP_SESSIONS_DIR}/`) || !target.endsWith(".jsonl")) continue;
    const mtimeMs = mtimeOf(target);
    if (mtimeMs == null) continue;
    if (!best || mtimeMs > best.mtimeMs) best = { path: target, mtimeMs };
  }
  return best?.path ?? null;
}

function ompLive(): LiveAgentSession[] {
  const out: LiveAgentSession[] = [];
  for (const pid of procPids()) {
    const cmdline = cmdlineOf(pid);
    if (!cmdline || !argvNamesAgent(cmdline, "omp")) continue;
    const transcript = ompTranscriptOf(pid);
    if (!transcript) continue; // matched the argv but holds no session — a one-shot invocation
    const sessionId = sessionIdFromTranscript(basename(transcript));
    if (!sessionId) continue;
    // /proc/<pid>/cwd is the truth; the directory name in the transcript path is a
    // lossy mangling and is only worth guessing from once the process is gone.
    const cwd = procCwd(pid) ?? transcriptCwd(transcript, basename(dirname(transcript)));
    if (!cwd) continue;
    const env = environOf(pid);
    const windowId = env?.get("KITTY_WINDOW_ID");
    out.push({
      agent: "omp",
      pid,
      sessionId,
      cwd,
      command: "omp",
      kittySocket: env?.get("KITTY_LISTEN_ON"),
      kittyWindowId: windowId ? Number(windowId) : undefined,
    });
  }
  return out;
}

// ── The table ───────────────────────────────────────────────────────────────────────

export const AGENTS: AgentAdapter[] = [
  {
    id: "claude",
    matches: (cmdline) => argvNamesAgent(cmdline, "claude"),
    commandForPid: (pid) => {
      const dir = environOf(pid)?.get("CLAUDE_CONFIG_DIR");
      return dir ? claudeCommandForConfigDir(dir) : null;
    },
    live: claudeLive,
    resumeArgv: (command, sessionId) => [command, "--resume", sessionId],
    continueArgv: (command) => [command, "-c"],
    transcripts: () =>
      claudeConfigDirs().flatMap((configDir) =>
        transcriptsUnder(join(configDir, "projects"), "claude", claudeCommandForConfigDir(configDir)),
      ),
  },
  {
    id: "omp",
    matches: (cmdline) => argvNamesAgent(cmdline, "omp"),
    // One launcher, no per-account config dir, so the pid has nothing to add.
    commandForPid: () => "omp",
    live: ompLive,
    resumeArgv: (_command, sessionId) => ["omp", "-r", sessionId],
    continueArgv: () => ["omp", "-c"],
    transcripts: () => transcriptsUnder(OMP_SESSIONS_DIR, "omp", "omp"),
  },
];

/** Every live session across every adapter. Dedupe by pid: one process, one session. */
export function liveAgentSessions(): LiveAgentSession[] {
  const seen = new Set<number>();
  const out: LiveAgentSession[] = [];
  for (const adapter of AGENTS) {
    for (const session of adapter.live()) {
      if (seen.has(session.pid)) continue;
      seen.add(session.pid);
      out.push(session);
    }
  }
  return out;
}

/** Session ids running right now — the duplicate-resume guard. */
export function liveSessionIds(): Set<string> {
  return new Set(liveAgentSessions().map((s) => s.sessionId));
}

/** btime from /proc/stat: seconds since the epoch at which this kernel booted. */
export function parseBootTime(procStat: string): number | null {
  const m = procStat.match(/^btime (\d+)$/m);
  return m ? Number(m[1]) * 1000 : null;
}

// btime is the only clock that survives the crash, so read it late and read it once.

/**
 * Sessions that predate this boot, newest first — the candidate set for recovery.
 *
 * There is no signal on disk that says "this session was open". A transcript's mtime is
 * its last ACTIVITY, so an open-but-idle session and one closed days ago look exactly
 * alike, and omp records nothing else: no pid registry, no session table, no terminal
 * record in the transcript. claude's `sessions/<pid>.json` survives an unclean kill and
 * is exact, but it is claude-only.
 *
 * So this deliberately does NOT try to be precise. It ranks by recency and lets a human
 * choose, because the two errors are not symmetric: a session offered that was already
 * closed costs one unticked row in a picker, while a session hidden is a session lost.
 * An earlier version cut this off 15 minutes before boot and made anything you had left
 * idle — a long build, a session you came back to in the morning — silently unrecoverable.
 *
 * `limit` bounds the list so a picker stays usable; `withinMs` is opt-in narrowing for
 * when you know roughly when the machine died. Anything live again has already been
 * recovered and is not a candidate.
 */
export function selectCrashVictims(
  records: TranscriptRecord[],
  bootMs: number,
  liveIds: Set<string>,
  withinMs?: number,
  limit = 25,
): TranscriptRecord[] {
  const candidates = records
    .filter(
      (r) =>
        r.mtimeMs <= bootMs && (withinMs == null || bootMs - r.mtimeMs <= withinMs) && !liveIds.has(r.sessionId),
    )
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  const seen = new Set<string>();
  const out: TranscriptRecord[] = [];
  for (const record of candidates) {
    if (seen.has(record.sessionId)) continue;
    seen.add(record.sessionId);
    out.push(record);
    if (out.length >= limit) break;
  }
  return out;
}

export function crashVictims(withinMs?: number, limit?: number): TranscriptRecord[] {
  let bootMs: number | null = null;
  try {
    bootMs = parseBootTime(readFileSync("/proc/stat", "utf-8"));
  } catch {
    return []; // no /proc — nothing to infer from
  }
  if (bootMs == null) return [];
  const records = AGENTS.flatMap((a) => a.transcripts());
  return selectCrashVictims(records, bootMs, liveSessionIds(), withinMs, limit);
}
