import { readdirSync, readFileSync } from "fs";
import { basename, join } from "path";
import { HOME_DIR } from "./config.ts";

// Claude Code maintains a live registry of interactive sessions at
// <config-dir>/sessions/<pid>.json. Each account runs against its own
// CLAUDE_CONFIG_DIR (~/.claude-work, ~/.claude-personal), so the dir a
// session's registry file lives in identifies its account — and hence the
// wrapper that resumes it. ~/.claude is scanned too (bare-claude backup).

export interface LiveClaudeSession {
  pid: number;
  sessionId: string;
  cwd: string;
  name?: string;
  /** Config dir the session was registered under (~/.claude-work, …). */
  configDir: string;
  /** Wrapper that resumes into this session's account (claude-work, …). */
  command: string;
  /** KITTY_LISTEN_ON of the hosting kitty instance, when resolvable. */
  kittySocket?: string;
  /** KITTY_WINDOW_ID inside that instance, when resolvable. */
  kittyWindowId?: number;
}

/**
 * Launcher that starts claude against a given CLAUDE_CONFIG_DIR. Each account
 * has a `claude-<account>` wrapper on PATH (packages/zsh/home/.local/bin) that
 * pins CLAUDE_CONFIG_DIR and applies headroom's setup; the bare ~/.claude
 * config resumes with plain `claude`. Unknown dirs fall back to bare claude.
 */
export function claudeCommandForConfigDir(configDir: string): string {
  const base = basename(configDir);
  if (base === ".claude") return "claude";
  const m = base.match(/^\.claude-(.+)$/);
  return m ? `claude-${m[1]}` : "claude";
}

/** Resume launcher for a live claude process, read from its CLAUDE_CONFIG_DIR. */
export function claudeCommandForPid(pid: number): string | null {
  const dir = environOf(pid)?.get("CLAUDE_CONFIG_DIR");
  return dir ? claudeCommandForConfigDir(dir) : null;
}

interface RegistryEntry {
  pid?: number;
  sessionId?: string;
  cwd?: string;
  procStart?: string | number;
  kind?: string;
  name?: string;
}

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

/** Registry entries whose process is alive AND is the same process that registered (procStart guard against PID reuse). */
export function liveClaudeSessions(): LiveClaudeSession[] {
  const configDirs = [
    join(HOME_DIR, ".claude-work"),
    join(HOME_DIR, ".claude-personal"),
    join(HOME_DIR, ".claude"),
  ];
  if (process.env.CLAUDE_CONFIG_DIR) configDirs.unshift(process.env.CLAUDE_CONFIG_DIR);

  const seen = new Set<number>();
  const out: LiveClaudeSession[] = [];
  for (const configDir of configDirs) {
    const dir = join(configDir, "sessions");
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
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
        pid: reg.pid,
        sessionId: reg.sessionId,
        cwd: reg.cwd,
        name: reg.name,
        configDir,
        command: claudeCommandForConfigDir(configDir),
        kittySocket: env?.get("KITTY_LISTEN_ON"),
        kittyWindowId: windowId ? Number(windowId) : undefined,
      });
    }
  }
  return out;
}
