// sgc — system garbage collector.
//
// Was ~/.local/bin/sgc, a standalone bash script. Merged into dot so it shares the repo's
// conventions and so `report` and `clean` are driven by ONE definition of "reclaimable"
// (src/lib/memory.ts findTargets), instead of a hardcoded process-name allowlist.
//
// Why the rewrite: the old sgc only reaped processes that were stopped OR reparented to
// PID 1 *and* matched a fixed name list (claude|auggie|serena|agentmemory|headroom). By
// 2026-07-28 it reported "nothing to reap" during an actual OOM, because the memory had
// moved into live, correctly-parented TypeScript language servers — which no allowlist was
// ever going to catch. The rules are now about process shape and size.

import { defineCommand } from "citty";
import { colors, logInfo, logSection, logSuccess, logWarn } from "../lib/console.ts";
import { run, spawnInherit } from "../lib/spawn.ts";
import {
  bar, families, findTargets, hr, readMemInfo, snapshot,
  type Family, type MemInfo, type Proc, type Target,
} from "../lib/memory.ts";

const BAR = 18;
const TOP = 10;

// ── report ───────────────────────────────────────────────────────────────────────

function renderHeadline(mi: MemInfo, swapDevices: string) {
  const pct = (v: number, t: number) => (t > 0 ? Math.round((v / t) * 100) : 0);
  const ramPct = pct(mi.used, mi.total);
  const swapPct = pct(mi.swapUsed, mi.swapTotal);

  // Colour is the fastest signal in a terminal, so spend it only on the headline.
  const paint = (p: number, s: string) => (p >= 85 ? colors.red(s) : p >= 65 ? colors.yellow(s) : colors.green(s));

  console.log(
    `  ${colors.bold("RAM ")}  ${paint(ramPct, bar(mi.used, mi.total, 30))}  ` +
    `${hr(mi.used).padStart(9)} / ${hr(mi.total).padEnd(9)}  ${colors.dim(`${hr(mi.available)} available`)}`,
  );
  console.log(
    `  ${colors.bold("SWAP")}  ${paint(swapPct, bar(mi.swapUsed, mi.swapTotal, 30))}  ` +
    `${hr(mi.swapUsed).padStart(9)} / ${hr(mi.swapTotal).padEnd(9)}  ${colors.dim(swapDevices)}`,
  );

  // Committed_AS over RAM is the honest over-commit signal: how much the kernel has
  // promised versus what exists. It is normal to exceed 100%; far above is a warning.
  const ratio = mi.total > 0 ? mi.committed / mi.total : 0;
  console.log(
    `        ${colors.dim(`commit ${hr(mi.committed)} — ${ratio.toFixed(1)}× RAM promised vs installed`)}`,
  );
}

function renderFamilies(fams: Family[], targets: Target[], procs: Proc[]) {
  const total = fams.reduce((s, f) => s + f.mem + f.swap, 0);
  const max = fams.length ? fams[0].mem + fams[0].swap : 0;

  // Reclaimable bytes per family, so the table itself shows where the wins are.
  const byFamily = new Map<string, number>();
  const pidFamily = new Map(procs.map((p) => [p.pid, p.family]));
  for (const t of targets) {
    const fam = pidFamily.get(t.pids[0]) ?? "unknown";
    byFamily.set(fam, (byFamily.get(fam) ?? 0) + t.mem);
  }

  // Fixed-width columns: every annotation occupies its slot whether or not it has a
  // value, so the eye can scan straight down a column instead of re-finding it per row.
  console.log(
    `  ${colors.dim("family".padEnd(17))} ${" ".repeat(BAR)} ${colors.dim("total".padStart(9))}  ` +
    `${colors.dim("procs")}  ${colors.dim("worst".padStart(9))}  ${colors.dim("of which swap".padStart(13))}  ${colors.dim("reclaimable")}`,
  );
  for (const f of fams.slice(0, TOP)) {
    const sum = f.mem + f.swap;
    const rec = byFamily.get(f.name) ?? 0;
    console.log(
      `  ${f.name.padEnd(17)} ${colors.cyan(bar(sum, max, BAR))} ${hr(sum).padStart(9)}` +
      // "~" sits against the number it qualifies, not out in the reclaimable column.
      `${f.estimated ? colors.dim("~") : " "} ` +
      `${String(f.count).padStart(5)}  ${colors.dim(hr(f.worst).padStart(9))}  ` +
      `${(f.swap > 0 ? colors.dim(hr(f.swap).padStart(13)) : " ".repeat(13))}  ` +
      `${rec > 0 ? colors.yellow(`⟲ ${hr(rec)}`) : ""}`,
    );
  }

  const rest = fams.slice(TOP);
  if (rest.length) {
    const restSum = rest.reduce((s, f) => s + f.mem + f.swap, 0);
    console.log(
      `  ${colors.dim(`…${rest.length} more`.padEnd(17))} ${" ".repeat(BAR)} ${colors.dim(hr(restSum).padStart(9))}`,
    );
  }

  const estimated = procs.filter((p) => p.estimated).length;
  console.log(`  ${colors.dim("─".repeat(17 + BAR + 11))}`);
  console.log(
    `  ${colors.bold("total".padEnd(17))} ${" ".repeat(BAR)} ${colors.bold(hr(total).padStart(9))}  ` +
    `${String(procs.length).padStart(3)} procs` +
    (estimated ? colors.dim(`   ~${estimated} measured by RSS (need root for PSS)`) : ""),
  );
}

/** Turn the table into decisions. Only emits lines that are actually true. */
function renderInsights(mi: MemInfo, fams: Family[], targets: Target[], procs: Proc[], earlyoom: boolean) {
  const lines: string[] = [];
  const total = fams.reduce((s, f) => s + f.mem + f.swap, 0);

  const top = fams[0];
  if (top && total > 0 && (top.mem + top.swap) / total > 0.2) {
    lines.push(
      `${colors.yellow("!")} ${colors.bold(top.name)} is ${Math.round(((top.mem + top.swap) / total) * 100)}% of all ` +
      `process memory — ${top.count} processes, worst ${hr(top.worst)}`,
    );
  }

  // Heap ceilings: a family can be small now and still be able to eat the machine.
  const caps = procs
    .map((p) => ({ p, cap: Number(p.args.match(/--max-old-space-size=(\d+)/)?.[1] ?? 0) }))
    .filter((x) => x.cap > 0);
  if (caps.length) {
    const totalCap = caps.reduce((s, x) => s + x.cap, 0);
    lines.push(
      `${colors.yellow("!")} ${caps.length} node process${caps.length > 1 ? "es" : ""} with ` +
      `--max-old-space-size — ${(totalCap / 1024).toFixed(1)} GiB of heap ceiling combined`,
    );
  }

  // Duplicate-instance smell. Counting distinct parents makes it actionable: 20 language
  // servers under 4 editors means most are redundant, which "20 processes" alone doesn't say.
  for (const f of fams.slice(0, 6)) {
    if (f.count >= 8 && f.mem > 512 * 1024 && f.name !== "compositor" && f.name !== "terminals") {
      const parents = new Set(procs.filter((p) => p.family === f.name).map((p) => p.ppid));
      lines.push(
        `${colors.yellow("!")} ${f.count}× ${f.name} under ${parents.size} parent process${parents.size === 1 ? "" : "es"}` +
        ` — likely more instances than you have open sessions`,
      );
      break;
    }
  }

  const stopped = targets.filter((t) => t.kind === "stopped");
  if (stopped.length) {
    const sum = stopped.reduce((s, t) => s + t.mem, 0);
    lines.push(`${colors.yellow("⟲")} ${stopped.length} stopped tree${stopped.length > 1 ? "s" : ""} holding ${hr(sum)} — pure waste, nothing will resume them`);
  }

  if (mi.swapTotal > 0 && mi.swapUsed / mi.swapTotal > 0.5) {
    lines.push(`${colors.red("!")} swap over half full — past zram, this is NVMe and it will feel slow`);
  }

  lines.push(
    earlyoom
      ? `${colors.green("✓")} earlyoom active — a runaway is killed before the kernel picks the wrong victim`
      : `${colors.red("✗")} earlyoom NOT active — run ${colors.bold("dot pkg oom configure")}`,
  );

  if (lines.length) {
    logSection("Worth knowing");
    for (const l of lines) console.log(`  ${l}`);
  }
}

async function swapDeviceSummary(): Promise<string> {
  const r = await run(["swapon", "--show=NAME,SIZE,PRIO", "--noheadings"]);
  if (r.exitCode !== 0 || !r.stdout.trim()) return "no swap configured";
  return r.stdout
    .trim()
    .split("\n")
    .map((l) => {
      const [name, size, prio] = l.trim().split(/\s+/);
      const short = name.includes("zram") ? "zram" : name.split("/").pop();
      return `${short} ${size} pri${prio}`;
    })
    .join(" · ");
}

async function earlyoomActive(): Promise<boolean> {
  return (await run(["systemctl", "is-active", "--quiet", "earlyoom.service"])).exitCode === 0;
}

async function report(): Promise<void> {
  const [mi, procs, swapDevs, eo] = await Promise.all([
    readMemInfo(), snapshot(), swapDeviceSummary(), earlyoomActive(),
  ]);
  const fams = families(procs);
  const targets = findTargets(procs);

  logSection("Memory");
  console.log("");
  renderHeadline(mi, swapDevs);

  logSection(`Where it went   ${colors.dim("PSS — shared pages counted once, so these sum honestly")}`);
  console.log("");
  renderFamilies(fams, targets, procs);

  renderInsights(mi, fams, targets, procs, eo);

  const rec = targets.reduce((s, t) => s + t.mem, 0);
  console.log("");
  if (rec > 0) {
    console.log(`  ${colors.bold("reclaimable now")}  ${colors.yellow(hr(rec))}   →  ${colors.bold("dot sgc clean")}`);
  } else {
    console.log(`  ${colors.dim("nothing reclaimable — every process is live and parented")}`);
  }
  console.log("");
}

// ── clean ────────────────────────────────────────────────────────────────────────

const KIND_LABEL: Record<Target["kind"], string> = {
  stopped: "Stopped process trees",
  tsserver: "Oversized TypeScript language servers",
  "orphan-mcp": "Orphaned MCP servers",
  "orphan-exiftool": "Orphaned exiftool workers",
};

async function confirm(prompt: string): Promise<boolean> {
  process.stdout.write(`  ${prompt} [y/N] `);
  for await (const line of console) return /^y(es)?$/i.test(line.trim());
  return false;
}

async function clean(opts: { yes: boolean; dryRun: boolean; stoppedMin: number; tsserverMin: number; only?: string }) {
  const before = await readMemInfo();
  let procs = await snapshot();
  let targets = findTargets(procs, {
    stoppedMin: opts.stoppedMin * 1024,
    tsserverMin: opts.tsserverMin * 1024,
  });
  if (opts.only) targets = targets.filter((t) => t.kind === opts.only);

  logSection("sgc clean");
  if (!targets.length) {
    console.log("");
    logSuccess("Nothing to reclaim — no stopped trees, no orphans, no oversized language servers.");
    logInfo(`Run ${colors.bold("dot sgc report")} to see where memory actually went.`);
    return;
  }

  let killed = 0;
  for (const kind of Object.keys(KIND_LABEL) as Target["kind"][]) {
    const group = targets.filter((t) => t.kind === kind);
    if (!group.length) continue;

    const sum = group.reduce((s, t) => s + t.mem, 0);
    console.log(`\n  ${colors.bold(KIND_LABEL[kind])}  ${colors.yellow(hr(sum))}`);
    for (const t of group) console.log(`    ${colors.dim("·")} ${hr(t.mem).padStart(9)}  ${t.label}`);

    if (opts.dryRun) { logInfo("(dry-run) not killing"); continue; }
    if (!opts.yes && !(await confirm(`kill ${group.length} target(s) in "${KIND_LABEL[kind]}"?`))) {
      logInfo("skipped");
      continue;
    }

    const pids = group.flatMap((t) => t.pids).map(String);
    // SIGKILL, not SIGTERM: a stopped process never handles a catchable signal, and the
    // rest of these are known-dead-weight rather than things we want to shut down nicely.
    await run(["kill", "-9", ...pids]);
    killed += pids.length;
    logSuccess(`killed ${pids.length} process(es)`);
  }

  if (opts.dryRun) { console.log(""); logInfo("dry-run, nothing changed"); return; }

  await Bun.sleep(1200);
  const after = await readMemInfo();
  const freedRam = before.used - after.used;
  const freedSwap = before.swapUsed - after.swapUsed;
  const fmt = (kib: number) => (kib > 0 ? colors.green(`freed ${hr(kib)}`) : kib < 0 ? colors.dim(`grew ${hr(-kib)}`) : colors.dim("no change"));
  console.log("");
  console.log(`  ${colors.bold("result")}  ${killed} process(es) killed   RAM ${fmt(freedRam)}   swap ${fmt(freedSwap)}`);
  console.log("");
}

// ── command ──────────────────────────────────────────────────────────────────────

export const sgcCommand = defineCommand({
  meta: {
    description: "System garbage collector — see what is eating RAM, then reclaim the waste",
  },
  // Bare `dot sgc` prints guidance and exits 0, matching `dot pkg` rather than citty's
  // default "ERROR No command specified".
  run({ args }) {
    if (args._?.length) return; // a subcommand matched; nothing to do here
    console.log(`
  ${colors.bold("dot sgc")} — system garbage collector

  ${colors.bold("dot sgc report")}   what is using memory, ranked by family
                   PSS-based, so shared pages are counted once and the
                   numbers actually add up. Flags duplicates, heap
                   ceilings, stopped trees, and swap pressure.

  ${colors.bold("dot sgc clean")}    reclaim the waste it found
                   stopped trees · orphaned MCP servers · orphaned
                   exiftool workers · oversized TypeScript servers
                   ${colors.dim("--dry-run to look first, --yes for timers, --only <kind>")}

  ${colors.bold("dot sgc mpv")}      restart the mpvpaper wallpaper (leaks over days)

  ${colors.dim("Start with `dot sgc report`; it tells you whether clean is worth running.")}
`);
  },
  subCommands: {
    report: defineCommand({
      meta: { description: "Rank memory by process family (PSS) and surface what is worth acting on" },
      async run() {
        await report();
      },
    }),

    clean: defineCommand({
      meta: { description: "Reclaim stopped trees, orphaned helpers, and oversized language servers" },
      args: {
        yes: { type: "boolean", description: "Skip confirmation prompts", default: false },
        "dry-run": { type: "boolean", description: "Report what would be killed, change nothing", default: false },
        "stopped-min": { type: "string", description: "MiB — ignore stopped trees smaller than this", default: "64" },
        "tsserver-min": { type: "string", description: "MiB — offer tsservers above this", default: "512" },
        only: { type: "string", description: "Limit to one kind: stopped | tsserver | orphan-mcp | orphan-exiftool" },
      },
      async run({ args }) {
        await clean({
          yes: Boolean(args.yes),
          dryRun: Boolean(args["dry-run"]),
          stoppedMin: Number(args["stopped-min"]) || 64,
          tsserverMin: Number(args["tsserver-min"]) || 512,
          only: args.only as string | undefined,
        });
      },
    }),

    mpv: defineCommand({
      meta: { description: "Restart the leaking mpvpaper wallpaper (grows over days of uptime)" },
      async run() {
        logSection("sgc mpv");
        const r = await run(["pgrep", "-x", "mpvpaper"]);
        if (r.exitCode !== 0) { logInfo("mpvpaper not running"); return; }
        // Derive SWAYSOCK rather than hardcoding it — the old script pinned a socket name
        // containing sway's PID, so it broke on every reboot.
        const sock = await run(["sh", "-c", "ls -t /run/user/$(id -u)/sway-ipc.*.sock 2>/dev/null | head -1"]);
        const swaysock = sock.stdout.trim();
        if (!swaysock) { logWarn("no sway IPC socket found — is sway running?"); return; }
        await run(["pkill", "-x", "mpvpaper"]);
        await spawnInherit(["setsid", "bash", `${process.env.HOME}/.config/sway/scripts/workspace-backgrounds.sh`], {
          env: { ...process.env, SWAYSOCK: swaysock } as Record<string, string>,
        });
        await Bun.sleep(2000);
        const back = await run(["pgrep", "-x", "mpvpaper"]);
        if (back.exitCode === 0) logSuccess("mpvpaper restarted");
        else logWarn("mpvpaper is not running after restart");
      },
    }),
  },
});
