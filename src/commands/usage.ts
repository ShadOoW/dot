// `dot usage` — track which installed software is actually used, and name what is not.
//
// The collector (`daemon`, driven by runit) and the reports (`report`, `unused`) share
// one definition of usage in src/lib/usage.ts, for the same reason `dot sgc` makes
// report and clean share findTargets: a tool that measures one thing and acts on
// another eventually recommends deleting something you use every day.

import { defineCommand } from "citty";
import { existsSync, statSync } from "fs";
import { colors, formatBytes, logError, logInfo, logSection, logSuccess, logWarn, writeStdout } from "../lib/console.ts";
import { reexecAsRoot } from "../lib/spawn.ts";
import {
  ACCT_V3_SIZE,
  acctActive,
  ATUIN_DB,
  findUnused,
  formatAge,
  importHistory,
  ingestAcct,
  loadPkgIndex,
  loadUsage,
  openStore,
  PACCT_FILE,
  resolveDbPath,
  sampleProc,
  scanAtimes,
  setAcct,
  SOURCES,
  usageByPkg,
  USAGE_DB,
  type PkgIndex,
  type Source,
  type UsageStore,
} from "../lib/usage.ts";

const DEFAULT_INTERVAL = 10;
/** atime and history are cheap but not free; once an hour is plenty at day granularity. */
const SLOW_SOURCE_INTERVAL = 3600;

const dbArg = { type: "string" as const, description: "Override the usage database path" };
// Lets you point at the *other* root's package database on a dual-boot box — which is
// also how the pacman reader is exercised from the Void boot.
const pkgdbArg = { type: "string" as const, description: "Override the package database dir (/var/db/xbps or /var/lib/pacman/local)" };

function openForWrite(explicit?: string): UsageStore {
  const path = resolveDbPath(explicit, true);
  const store = openStore(path);
  if (path !== USAGE_DB) {
    logWarn(`writing ${path} — not root, so ${USAGE_DB} is unavailable and only your own processes are visible`);
  }
  return store;
}

function openForRead(explicit?: string, pkgdb?: string): { store: UsageStore; index: PkgIndex } | null {
  const path = resolveDbPath(explicit);
  if (!existsSync(path)) {
    logError(`no usage database at ${path}`);
    logInfo(`start collecting with ${colors.bold("dot usage collect --all")}, or enable the service: ${colors.bold("dot link usage")}`);
    return null;
  }
  return { store: openStore(path, true), index: loadPkgIndex(pkgdb) };
}

/**
 * One pass over the sources selected. `proc` and `acct` are cheap enough for every
 * tick; `atime` and `history` re-derive the same historical facts each time and only
 * need to run occasionally, which is why the daemon rations them separately.
 */
function collectOnce(
  store: UsageStore,
  index: PkgIndex,
  want: Record<Source, boolean>,
  interval: number,
  quiet = false,
): Record<Source, number> {
  const counts: Record<Source, number> = { acct: 0, proc: 0, atime: 0, history: 0 };

  if (want.acct) {
    const ing = ingestAcct();
    counts.acct = store.record(ing.observations, index);
    if (!quiet && ing.records) logInfo(`acct    ${ing.records} exits -> ${ing.observations.length} commands`);
  }

  if (want.proc) {
    const s = sampleProc(interval);
    counts.proc = store.record(s.observations, index);
    if (!quiet) {
      const note = s.resolved < s.total ? colors.dim(` (${s.total - s.resolved} PIDs need root)`) : "";
      logInfo(`proc    ${s.resolved}/${s.total} PIDs resolved${note}`);
    }
  }

  if (want.atime) {
    const scan = scanAtimes(index);
    counts.atime = store.record(scan.observations, index);
    store.setMeta("atime:last", String(Math.floor(Date.now() / 1000)));
    store.setMeta("atime:discarded", String(scan.discarded));
    store.setMeta("atime:warning", scan.warning ?? "");
    if (!quiet) {
      logInfo(`atime   ${scan.observations.length} of ${scan.scanned} executables usable`);
      if (scan.warning) logWarn(scan.warning);
      // A package database describing executables that are not on this filesystem means
      // the two do not belong together — most often `--pkgdb` aimed at the other root
      // of a dual-boot box, where the dependency graph is valid but the usage evidence
      // is this system's. Left silent, that reads as "nothing is used".
      const total = scan.scanned + scan.missing;
      if (total && scan.missing / total > 0.2) {
        logWarn(
          `${scan.missing} of ${total} package executables do not exist on this filesystem — ` +
            `the package database and the running system are not the same install, so usage evidence does not apply to it`,
        );
      }
    }
  }

  if (want.history) {
    const since = Number(store.getMeta("history:cursor") ?? 0);
    const imp = importHistory(index, since);
    counts.history = store.record(imp.observations, index);
    store.setMeta("history:cursor", String(imp.cursor));
    if (!quiet) logInfo(`history ${imp.rows} new commands -> ${imp.observations.length} programs`);
  }

  return counts;
}

/** Resolves --source/--all flags into the per-source switches collectOnce wants. */
function wantedSources(args: { source?: string; all?: boolean }): Record<Source, boolean> {
  if (args.source) {
    const picked = args.source.split(",").map((s) => s.trim());
    const bad = picked.filter((p) => !SOURCES.includes(p as Source));
    if (bad.length) throw new Error(`unknown source(s): ${bad.join(", ")} (valid: ${SOURCES.join(", ")})`);
    return {
      acct: picked.includes("acct"),
      proc: picked.includes("proc"),
      atime: picked.includes("atime"),
      history: picked.includes("history"),
    };
  }
  // Default is the cheap live pair; --all adds the two retrospective scans.
  return { acct: true, proc: true, atime: !!args.all, history: !!args.all };
}

const collect = defineCommand({
  meta: { description: "Take one usage sample (proc + acct; --all adds atime + shell history)" },
  args: {
    all: { type: "boolean", short: "a", description: "Also run the atime scan and history import" },
    source: { type: "string", short: "s", description: `Comma-separated subset of: ${SOURCES.join(", ")}` },
    db: dbArg,
    pkgdb: pkgdbArg,
  },
  run({ args }) {
    logSection("Usage collect");
    const store = openForWrite(args.db);
    try {
      const index = loadPkgIndex(args.pkgdb);
      const counts = collectOnce(store, index, wantedSources(args), DEFAULT_INTERVAL);
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      logSuccess(`recorded ${total} observations into ${store.path}`);
    } finally {
      store.close();
    }
  },
});

const daemon = defineCommand({
  meta: { description: "Run the collector in a loop (this is what the runit service execs)" },
  args: {
    interval: { type: "string", short: "i", description: `Seconds between samples (default ${DEFAULT_INTERVAL})` },
    db: dbArg,
    pkgdb: pkgdbArg,
  },
  async run({ args }) {
    const interval = Math.max(1, Number(args.interval ?? DEFAULT_INTERVAL));
    const store = openForWrite(args.db);
    const index = loadPkgIndex(args.pkgdb);

    // A restart must not lose the accounting file: point acct(2) at it again, since
    // the kernel forgets on reboot. Failure is not fatal — proc sampling still works.
    const acct = setAcct(PACCT_FILE);
    if (!acct.ok) logWarn(`process accounting unavailable: ${acct.error}`);

    let running = true;
    for (const sig of ["SIGTERM", "SIGINT"] as const) {
      process.on(sig, () => {
        running = false;
      });
    }

    console.log(`dot usage daemon: interval=${interval}s db=${store.path} acct=${acct.ok ? "on" : "off"}`);
    let lastSlow = 0;
    while (running) {
      const now = Date.now() / 1000;
      const slow = now - lastSlow >= SLOW_SOURCE_INTERVAL;
      if (slow) lastSlow = now;
      try {
        collectOnce(store, index, { acct: acct.ok, proc: true, atime: slow, history: slow }, interval, true);
      } catch (e) {
        // A single bad tick must not take the supervisor down — runit would restart
        // us into the same failure and spin. Log and keep sampling.
        console.error(`tick failed: ${(e as Error).message}`);
      }
      await Bun.sleep(interval * 1000);
    }
    store.close();
  },
});

const report = defineCommand({
  meta: { description: "What is being used: ranked by invocations and by wall time" },
  args: {
    top: { type: "string", short: "n", description: "Rows per table (default 20)" },
    manager: { type: "string", short: "m", description: "Only show one manager (xbps, nix, cargo, bun, local, …)" },
    json: { type: "boolean", description: "Machine-readable output" },
    db: dbArg,
    pkgdb: pkgdbArg,
  },
  async run({ args }) {
    const opened = openForRead(args.db, args.pkgdb);
    if (!opened) return process.exit(1);
    const { store, index } = opened;
    try {
      const top = Math.max(1, Number(args.top ?? 20));
      let bins = loadUsage(store.db);
      if (args.manager) bins = bins.filter((b) => b.manager === args.manager);

      if (args.json) {
        await writeStdout(JSON.stringify({ manager: index.manager, bins, packages: [...usageByPkg(bins, index.manager).values()] }, null, 2));
        return;
      }

      logSection("Usage report");

      const since: Partial<Record<Source, number>> = {};
      for (const b of bins) for (const s of b.sources) since[s] = Math.min(since[s] ?? Infinity, b.firstSeen);
      logInfo(`db ${store.path} (${formatBytes(statSync(store.path).size)}), ${bins.length} executables observed`);
      for (const s of SOURCES) {
        const from = since[s];
        console.log(
          from
            ? `    ${colors.cyan(s.padEnd(8))} evidence back to ${new Date(from * 1000).toISOString().slice(0, 10)} (${formatAge(from)})`
            : `    ${colors.dim(s.padEnd(8))} ${colors.dim("no data")}`,
        );
      }
      const warning = store.getMeta("atime:warning");
      if (warning) logWarn(`atime: ${warning}`);

      logSection(`Most invoked (top ${top})`);
      for (const b of [...bins].sort((x, y) => y.count - x.count).slice(0, top)) {
        const owner = b.pkg ? `${b.manager}/${b.pkg}` : b.manager;
        console.log(
          `  ${String(b.count).padStart(7)}  ${b.name.padEnd(24)} ${colors.dim(owner.padEnd(26))} ${colors.dim(formatAge(b.lastSeen))}`,
        );
      }

      logSection(`Most wall time (top ${top})`);
      for (const b of [...bins].sort((x, y) => y.seconds - x.seconds).slice(0, top)) {
        if (!b.seconds) break;
        const h = (b.seconds / 3600).toFixed(1);
        console.log(`  ${h.padStart(9)}h  ${b.name.padEnd(24)} ${colors.dim(b.pkg ?? b.manager)}`);
      }

      logSection("By manager");
      const byManager = new Map<string, { bins: number; count: number }>();
      for (const b of bins) {
        const e = byManager.get(b.manager) ?? { bins: 0, count: 0 };
        e.bins++;
        e.count += b.count;
        byManager.set(b.manager, e);
      }
      for (const [m, e] of [...byManager].sort((a, b) => b[1].bins - a[1].bins)) {
        console.log(`  ${m.padEnd(12)} ${String(e.bins).padStart(5)} executables  ${String(e.count).padStart(8)} invocations`);
      }

      const pkgs = usageByPkg(bins, index.manager);
      logInfo(`${pkgs.size} of ${index.pkgs.size} ${index.manager} packages have a usage record`);
    } finally {
      store.close();
    }
  },
});

const unused = defineCommand({
  meta: { description: "Packages nothing has used and nothing needed depends on" },
  args: {
    days: { type: "string", short: "d", description: "Consider unused after this many days (default 90)" },
    reason: { type: "string", short: "r", description: "Filter: manual-unused, orphaned, dead-library, passive" },
    "no-atime": { type: "boolean", description: "Ignore atime evidence — only count what was exec'd" },
    all: { type: "boolean", short: "a", description: "Show every candidate, not just the top 30" },
    json: { type: "boolean", description: "Machine-readable output" },
    db: dbArg,
    pkgdb: pkgdbArg,
  },
  async run({ args }) {
    const opened = openForRead(args.db, args.pkgdb);
    if (!opened) return process.exit(1);
    const { store, index } = opened;
    try {
      const days = Math.max(1, Number(args.days ?? 90));
      const bins = loadUsage(store.db);
      const res = findUnused(index, bins, { days, trustAtime: !args["no-atime"] });

      if (args.json) {
        await writeStdout(JSON.stringify(res, null, 2));
        return;
      }

      logSection(`Unused packages (nothing in ${days} days)`);
      logInfo(
        `${res.used} packages used, ${res.keptByDependency} kept because something used needs them, ` +
          `${res.protectedCount} protected as base system`,
      );

      // Absence of evidence only means absence of use once a source has been watching
      // the whole window. Saying so up front is the difference between a usable tool
      // and one that talks somebody into removing their bootloader.
      if (res.underCovered.length) {
        logWarn(
          `${res.underCovered.join(", ")} ${res.underCovered.length === 1 ? "has" : "have"} less than ${days} days of history — ` +
            `treat this list as provisional until the collector has been running that long`,
        );
      }
      if (!acctActive()) {
        logWarn("process accounting is off, so short-lived commands are invisible: run `dot usage acct on` as root");
      }

      // Passive packages are reported, never recommended: execution evidence has
      // nothing to say about firmware, initramfs content, dlopen'd drivers or
      // multilib, so folding them into the removal list would give a confident
      // answer to a question this tool cannot answer.
      const passive = res.candidates.filter((c) => c.reason === "passive");
      const removable = res.candidates.filter((c) => c.reason !== "passive");
      const shown = args.reason ? res.candidates.filter((c) => c.reason === args.reason) : removable;

      if (!shown.length && !passive.length) {
        logSuccess("no removal candidates — everything installed is either used or required");
        return;
      }

      const label: Record<string, (s: string) => string> = {
        "manual-unused": colors.yellow,
        orphaned: colors.red,
        "dead-library": colors.dim,
        passive: colors.blue,
      };
      const row = (c: (typeof res.candidates)[number]) => {
        const tag = (label[c.reason] ?? colors.dim)(c.reason.padEnd(13));
        // A package can ship a binary *and* firmware or a service unit. The exec
        // verdict stands, but the reader needs to see the other consumer exists.
        const kinds = c.pkg.passive.length ? colors.blue(` [${c.pkg.passive.join(",")}]`) : "";
        const extra = c.unusedRevdeps.length ? colors.dim(` +${c.unusedRevdeps.length} dependants also unused`) : "";
        console.log(
          `  ${tag} ${c.pkg.name.padEnd(28)} ${formatBytes(c.pkg.size).padStart(9)}  ${colors.dim(formatAge(c.lastSeen).padEnd(10))}${kinds}${extra}`,
        );
      };

      const limit = args.all ? shown.length : Math.min(30, shown.length);
      let reclaim = 0;
      for (const c of shown) reclaim += c.pkg.size;
      console.log();
      for (const c of shown.slice(0, limit)) row(c);
      if (limit < shown.length) logInfo(colors.dim(`… ${shown.length - limit} more (--all to list)`));

      console.log();
      logInfo(`${shown.length} candidates, ${formatBytes(reclaim)} reclaimable`);
      logInfo(
        colors.dim(
          "manual-unused = you asked for it and never ran it · orphaned = dependency nothing wanted still needs · dead-library = a library you asked for with no executables and no live dependants",
        ),
      );
      const manual = shown.filter((c) => c.reason === "manual-unused").map((c) => c.pkg.name);
      if (manual.length) {
        // The escalation belongs to the removal command, not to dot: printing `sudo`
        // here is a suggestion the reader runs deliberately, never something dot does.
        const cmd =
          index.manager === "pacman" ? "sudo pacman -Rns" : "sudo xbps-remove -Ro";
        logInfo(`review, then: ${colors.bold(`${cmd} ${manual.slice(0, 8).join(" ")}`)}`);
      }

      if (passive.length && !args.reason) {
        logSection(`Cannot be judged by execution (${passive.length})`);
        logInfo(
          colors.dim(
            "loaded by the kernel, the initramfs, a dlopen registry, the 32-bit interpreter or a plugin host — decide these by hand, never from this list",
          ),
        );
        const kinds = new Map<string, number>();
        for (const c of passive) for (const k of c.pkg.passive) kinds.set(k, (kinds.get(k) ?? 0) + 1);
        let passiveBytes = 0;
        for (const c of passive) passiveBytes += c.pkg.size;
        logInfo(
          `${formatBytes(passiveBytes)} across ${[...kinds]
            .sort((a, b) => b[1] - a[1])
            .map(([k, n]) => `${k} ${n}`)
            .join(", ")}`,
        );
        if (args.all) for (const c of passive) row(c);
        else logInfo(colors.dim("--all to list them, or -r passive"));
      }
    } finally {
      store.close();
    }
  },
});

const acct = defineCommand({
  meta: { description: "Turn kernel process accounting on or off (escalates on its own)" },
  args: {
    state: { type: "positional", required: true, description: "on | off | status" },
  },
  run({ args }) {
    const state = String(args.state);
    if (state === "status") {
      const on = acctActive();
      const size = existsSync(PACCT_FILE) ? statSync(PACCT_FILE).size : 0;
      logInfo(`process accounting: ${on ? colors.green("on") : colors.yellow("off")}`);
      logInfo(`${PACCT_FILE}: ${formatBytes(size)} (${Math.floor(size / ACCT_V3_SIZE)} pending records)`);
      return;
    }
    if (state !== "on" && state !== "off") {
      logError(`expected on, off or status — got "${state}"`);
      return process.exit(2);
    }
    // acct(2) needs CAP_SYS_PACCT. Escalate here rather than making the caller type
    // `sudo dot`, which cannot work — see reexecAsRoot.
    if (process.getuid?.() !== 0) {
      reexecAsRoot(`turning process accounting ${state} needs root (CAP_SYS_PACCT)`);
    }
    const r = setAcct(state === "on" ? PACCT_FILE : null);
    if (!r.ok) {
      logError(r.error ?? "failed");
      return process.exit(1);
    }
    logSuccess(`process accounting ${state}`);
    if (state === "on") logInfo(`records land in ${PACCT_FILE}; the collector drains and truncates it each tick`);
  },
});

const status = defineCommand({
  meta: { description: "Whether tracking is working, and what each source can see" },
  args: { db: dbArg },
  run({ args }) {
    logSection("Usage tracking status");
    const path = resolveDbPath(args.db);
    if (!existsSync(path)) {
      logWarn(`no database at ${path} — nothing has been collected yet`);
    } else {
      const store = openStore(path, true);
      try {
        const rows = store.db
          .query<{ source: Source; bins: number; obs: number; first: number; last: number }, []>(
            "SELECT source, count(*) bins, sum(count) obs, min(first_seen) first, max(last_seen) last FROM usage GROUP BY source",
          )
          .all();
        logInfo(`database ${path} (${formatBytes(statSync(path).size)})`);
        for (const s of SOURCES) {
          const r = rows.find((x) => x.source === s);
          if (!r) {
            console.log(`  ${colors.dim("○")} ${colors.dim(s.padEnd(8))} ${colors.dim("no data")}`);
            continue;
          }
          console.log(
            `  ${colors.green("●")} ${s.padEnd(8)} ${String(r.bins).padStart(5)} executables, ${String(r.obs).padStart(8)} observations, ` +
              `${formatAge(r.first)} → ${formatAge(r.last)}`,
          );
        }
        const warning = store.getMeta("atime:warning");
        if (warning) logWarn(`atime: ${warning}`);
      } finally {
        store.close();
      }
    }

    logSection("Sources");
    const on = acctActive();
    console.log(
      `  ${on ? colors.green("●") : colors.yellow("○")} acct     kernel process accounting ${on ? "on" : "off — `dot usage acct on` as root for complete coverage"}`,
    );
    console.log(`  ${colors.green("●")} proc     /proc polling${process.getuid?.() === 0 ? "" : colors.dim(" (unprivileged: only your own processes)")}`);
    console.log(`  ${colors.green("●")} atime    relatime on /, so ~1 day granularity`);
    console.log(
      `  ${existsSync(ATUIN_DB) ? colors.green("●") : colors.yellow("○")} history  ${existsSync(ATUIN_DB) ? ATUIN_DB : "no atuin database"}`,
    );
  },
});

export const usageCommand = defineCommand({
  meta: { name: "usage", description: "Track software usage and find packages nothing needs" },
  subCommands: { collect, daemon, report, unused, acct, status },
});
