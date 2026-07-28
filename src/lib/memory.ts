// Memory snapshot, process-family classification, and reclaim-target detection.
// Shared by `dot sgc report` (show) and `dot sgc clean` (act) so the two can never
// disagree about what is reclaimable.
//
// ── Why PSS and not RSS ──────────────────────────────────────────────────────────
// RSS counts every shared page in full, in every process that maps it. Summing RSS
// across a family therefore double-counts the shared node/electron/chromium text and
// libraries once per process. Measured on this machine: a naive RSS sum reads
// 24.0 GiB against a true 14.3 GiB — a 68% overstatement, and it gets worse the more
// processes a family has, which is exactly the case we care about.
//
// PSS (Proportional Set Size) divides each shared page by its number of mappers, which
// makes it *additive*: summing a family's PSS is meaningful. That is the whole reason
// smem reports it. See proc_pid_smaps(5).
//
// We read /proc/PID/smaps_rollup — the kernel's pre-aggregated rollup (4.14+) — rather
// than parsing per-mapping smaps. Cost is ~46 ms for every process on this box.
//
// Not every process is readable unprivileged (248 of 655 here); for those we fall back
// to RSS from ps and mark the row `estimated`, so coverage is complete and the accuracy
// tradeoff is visible instead of silent.

import { run } from "./spawn.ts";

export interface Proc {
  pid: number;
  ppid: number;
  /** ps STAT field; leading "T" means stopped (SIGSTOP / Ctrl-Z / abandoned). */
  state: string;
  /** KiB. PSS where readable, else RSS (see `estimated`). */
  mem: number;
  /** KiB of swap (SwapPss where readable). */
  swap: number;
  /** true when `mem` fell back to RSS because smaps_rollup was not readable. */
  estimated: boolean;
  comm: string;
  args: string;
  family: string;
}

export interface Family {
  name: string;
  mem: number;
  swap: number;
  count: number;
  /** Largest single instance — distinguishes "one hog" from "death by a thousand cuts". */
  worst: number;
  worstPid: number;
  estimated: boolean;
}

export interface MemInfo {
  total: number;
  available: number;
  used: number;
  swapTotal: number;
  swapUsed: number;
  committed: number;
}

// ── classification ───────────────────────────────────────────────────────────────
// First match wins, so order matters. MCP servers are node processes whose argv often
// mentions the agent that spawned them, so they must be tested before the generic
// node/claude rules or they get misattributed.
const RULES: { family: string; test: RegExp }[] = [
  { family: "mcp-servers",    test: /--mcp\b|mcp\s+serve|start-mcp-server|mcp-server|agentmemory mcp/ },
  { family: "typescript-lsp", test: /tsserver\.js|typescript-language-server|\bvtsls\b/ },
  { family: "claude-code",    test: /claude-code-linux|\/(bin\/)?claude(\s|$)|claude daemon/ },
  { family: "vite/bundler",   test: /\bvite\b|webpack|esbuild --serve|next dev|rollup/ },
  { family: "agentmemory",    test: /agentmemory|\biii\b --config/ },
  { family: "ai proxies",     test: /headroom|litellm|ollama|llama-server/ },
  { family: "language-servers", test: /lua-language-server|rust-analyzer|\bgopls\b|pyright|basedpyright|clangd|jdtls|omnisharp/ },
  { family: "vivaldi",        test: /vivaldi-bin|vivaldi/ },
  { family: "chromium",       test: /chromium|chrome-sandbox/ },
  { family: "electron apps",  test: /electron|insomnia|slack|discord|obsidian/ },
  { family: "immich",         test: /immich/ },
  { family: "photoview",      test: /photoview|exiftool/ },
  { family: "postgres",       test: /\bpostgres\b/ },
  { family: "netdata",        test: /netdata/ },
  { family: "media servers",  test: /Lidarr|Prowlarr|Radarr|Sonarr|navidrome|jellyfin/ },
  { family: "browsers (other)", test: /firefox|qutebrowser/ },
  { family: "terminals",      test: /\bkitty\b|foot|alacritty/ },
  { family: "editors",        test: /\bnvim\b|\bvim\b|helix\b/ },
  { family: "wallpaper",      test: /mpvpaper/ },
  { family: "compositor",     test: /\bsway\b|Xwayland|swaybar|waybar|mako/ },
  { family: "containers",     test: /dockerd|containerd|podman/ },
  { family: "node (other)",   test: /\bnode\b|node-MainThread/ },
  { family: "bun (other)",    test: /\bbun\b/ },
];

export function classify(comm: string, args: string): string {
  const hay = `${comm} ${args}`;
  for (const r of RULES) if (r.test.test(hay)) return r.family;
  return comm || "unknown";
}

// ── collection ───────────────────────────────────────────────────────────────────

export async function readMemInfo(): Promise<MemInfo> {
  const txt = await Bun.file("/proc/meminfo").text();
  const g = (k: string) => {
    const m = txt.match(new RegExp(`^${k}:\\s+(\\d+)`, "m"));
    return m ? Number(m[1]) : 0;
  };
  const total = g("MemTotal");
  const available = g("MemAvailable");
  const swapTotal = g("SwapTotal");
  return {
    total,
    available,
    used: total - available,
    swapTotal,
    swapUsed: swapTotal - g("SwapFree"),
    committed: g("Committed_AS"),
  };
}

/**
 * One snapshot of every process. `ps` gives the always-readable skeleton (pid/ppid/
 * state/rss/args); smaps_rollup upgrades mem to PSS wherever permission allows.
 */
export async function snapshot(): Promise<Proc[]> {
  const psOut = await run(["ps", "-eo", "pid=,ppid=,stat=,rss=,comm=,args=", "--no-headers"]);

  // One grep across the whole glob: a shell is needed for expansion, and grep (unlike
  // awk) keeps going past the files it cannot open instead of aborting on the first.
  const rollup = await run([
    "sh",
    "-c",
    "grep -H -E '^(Pss|SwapPss):' /proc/[0-9]*/smaps_rollup 2>/dev/null || true",
  ]);

  const pss = new Map<number, number>();
  const swap = new Map<number, number>();
  for (const line of rollup.stdout.split("\n")) {
    // /proc/1234/smaps_rollup:Pss:   123 kB
    const m = line.match(/^\/proc\/(\d+)\/smaps_rollup:(Pss|SwapPss):\s+(\d+)/);
    if (!m) continue;
    const pid = Number(m[1]);
    const kib = Number(m[3]);
    if (m[2] === "Pss") pss.set(pid, kib);
    else swap.set(pid, kib);
  }

  const procs: Proc[] = [];
  for (const line of psOut.stdout.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    const rss = Number(m[4]);
    const have = pss.has(pid);
    const comm = m[5];
    const args = m[6];
    // Skip kernel threads. They hold no userspace memory but each has a unique comm
    // (kworker/3:1H, ksoftirqd/7, …), so leaving them in produced ~400 bogus one-process
    // "families" that buried the real ones under a "…395 more" line.
    if (/^\[.*\]$/.test(args.trim()) || pid === 2 || Number(m[2]) === 2) continue;
    procs.push({
      pid,
      ppid: Number(m[2]),
      state: m[3],
      mem: have ? pss.get(pid)! : rss,
      swap: swap.get(pid) ?? 0,
      estimated: !have,
      comm,
      args,
      family: classify(comm, args),
    });
  }
  return procs;
}

export function families(procs: Proc[]): Family[] {
  const map = new Map<string, Family>();
  for (const p of procs) {
    let f = map.get(p.family);
    if (!f) {
      f = { name: p.family, mem: 0, swap: 0, count: 0, worst: 0, worstPid: 0, estimated: false };
      map.set(p.family, f);
    }
    f.mem += p.mem;
    f.swap += p.swap;
    f.count++;
    // worst must use the same measure as the row total (resident + swapped), otherwise a
    // heavily-swapped family reads as "2.2 GiB total, worst 51 MiB" and looks broken.
    if (p.mem + p.swap > f.worst) { f.worst = p.mem + p.swap; f.worstPid = p.pid; }
    if (p.estimated) f.estimated = true;
  }
  return [...map.values()].sort((a, b) => b.mem + b.swap - (a.mem + a.swap));
}

// ── reclaim targets ──────────────────────────────────────────────────────────────

export interface Target {
  kind: "stopped" | "tsserver" | "orphan-mcp" | "orphan-exiftool";
  pids: number[];
  mem: number;
  label: string;
}

/** Children index for subtree walks. */
function childrenOf(procs: Proc[]): Map<number, Proc[]> {
  const kids = new Map<number, Proc[]>();
  for (const p of procs) {
    const list = kids.get(p.ppid);
    if (list) list.push(p);
    else kids.set(p.ppid, [p]);
  }
  return kids;
}

function subtree(root: Proc, kids: Map<number, Proc[]>): Proc[] {
  const out: Proc[] = [root];
  const stack = [root.pid];
  while (stack.length) {
    for (const c of kids.get(stack.pop()!) ?? []) {
      out.push(c);
      stack.push(c.pid);
    }
  }
  return out;
}

export interface ReclaimOpts {
  /** KiB — ignore stopped trees smaller than this. */
  stoppedMin?: number;
  /** KiB — offer tsservers above this. */
  tsserverMin?: number;
}

/**
 * What is safely reclaimable right now.
 *
 * The original sgc only looked for *named* processes that were stopped or reparented to
 * PID 1. That model stopped finding anything, because the memory moved into live,
 * correctly-parented language servers — so these rules are about process *shape* and
 * *size*, not an allowlist of names that has to be kept up to date.
 */
export function findTargets(procs: Proc[], opts: ReclaimOpts = {}): Target[] {
  const stoppedMin = opts.stoppedMin ?? 64 * 1024;
  const tsserverMin = opts.tsserverMin ?? 512 * 1024;
  const kids = childrenOf(procs);
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const targets: Target[] = [];

  // 1. Stopped trees. A tree whose root is stopped is an abandoned Ctrl-Z / orphaned
  //    job: it holds its whole footprint and will never make progress. Only the
  //    outermost stopped process is reported so a tree is not counted twice.
  for (const p of procs) {
    if (!p.state.startsWith("T")) continue;
    const parent = byPid.get(p.ppid);
    if (parent?.state.startsWith("T")) continue; // inner node of a stopped tree
    const tree = subtree(p, kids);
    const mem = tree.reduce((s, q) => s + q.mem + q.swap, 0);
    if (mem < stoppedMin) continue;
    targets.push({
      kind: "stopped",
      pids: tree.map((q) => q.pid),
      mem,
      label: `stopped tree: ${p.comm} (${tree.length} proc${tree.length > 1 ? "s" : ""}) — ${p.args.slice(0, 60)}`,
    });
  }

  // 2. Fat TypeScript language servers. Safe to kill: every LSP client respawns them on
  //    demand. The cost is a reindex, not lost work. Several here run with
  //    --max-old-space-size=3072, i.e. a 3 GiB ceiling *each*.
  for (const p of procs) {
    if (p.family !== "typescript-lsp") continue;
    if (p.mem + p.swap < tsserverMin) continue;
    const cap = p.args.match(/--max-old-space-size=(\d+)/)?.[1];
    targets.push({
      kind: "tsserver",
      pids: [p.pid],
      mem: p.mem + p.swap,
      label: `tsserver pid ${p.pid}${cap ? ` (heap cap ${cap} MiB)` : ""} — respawns on demand`,
    });
  }

  // 3. MCP servers reparented to PID 1 — their agent died, nothing will ever talk to them.
  for (const p of procs) {
    if (p.ppid !== 1 || p.family !== "mcp-servers") continue;
    targets.push({
      kind: "orphan-mcp",
      pids: [p.pid],
      mem: p.mem + p.swap,
      label: `orphaned MCP server pid ${p.pid} — ${p.args.slice(0, 60)}`,
    });
  }

  // 4. Orphaned exiftool -stay_open from photoview's ML service; photoview respawns them.
  for (const p of procs) {
    if (p.ppid !== 1 || !/exiftool.*-stay_open True/.test(p.args)) continue;
    targets.push({
      kind: "orphan-exiftool",
      pids: [p.pid],
      mem: p.mem + p.swap,
      label: `orphaned exiftool pid ${p.pid}`,
    });
  }

  return targets.sort((a, b) => b.mem - a.mem);
}

// ── formatting ───────────────────────────────────────────────────────────────────

/** KiB -> "1.2 GiB" / "512 MiB". Fixed shape so columns line up. */
export function hr(kib: number): string {
  if (kib >= 1024 * 1024) return `${(kib / 1048576).toFixed(1)} GiB`;
  if (kib >= 1024) return `${Math.round(kib / 1024)} MiB`;
  return `${kib} KiB`;
}

const BLOCKS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];

/** Proportional bar with 1/8-cell resolution, so small values stay visible. */
export function bar(value: number, max: number, width: number): string {
  if (max <= 0) return "".padEnd(width);
  const cells = Math.max(0, Math.min(width, (value / max) * width));
  let full = Math.floor(cells);
  let rem = Math.round((cells - full) * 8);
  // Math.round can land on 8, which is past the end of BLOCKS — that printed "undefined"
  // straight into the bar. 8 eighths is just another full cell.
  if (rem >= 8) { full++; rem = 0; }
  const s = "█".repeat(Math.min(full, width)) + (rem > 0 && full < width ? BLOCKS[rem] : "");
  return s.padEnd(width);
}
