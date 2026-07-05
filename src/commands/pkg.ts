import { defineCommand } from "citty";
import { confirm } from "@clack/prompts";
import { existsSync } from "fs";
import { join } from "path";
import { PACKAGES_DIR } from "../lib/config.ts";
import { appliesToHost, collectFiles, detectDistro, detectHost, getPackageMeta, listPackages } from "../lib/pkg.ts";
import { checkFileStatus, type FileStatus } from "../lib/status.ts";
import { colors, logError, logInfo, logSection, logSuccess, logWarn } from "../lib/console.ts";
import { linkPackage, unlinkPackage } from "./link.ts";
import { showPackageInfo, runConfigure, runInitScript } from "./info.ts";

async function showPackageStatus(pkg: string): Promise<boolean> {
  const pkgDir = join(PACKAGES_DIR, pkg);
  if (!existsSync(pkgDir)) { logError(`Package "${pkg}" not found`); return false; }

  const homeFiles = await collectFiles(pkgDir, "home");
  const systemFiles = await collectFiles(pkgDir, "system");
  const allFiles = [...homeFiles, ...systemFiles];

  if (allFiles.length === 0) {
    console.log(`  ${colors.dim(pkg)}: no files`);
    return true;
  }

  const statusIcon: Record<FileStatus, string> = {
    ok:      colors.green("✓"),
    broken:  colors.red("✗"),
    missing: colors.yellow("?"),
    drift:   colors.yellow("~"),
  };
  const statusLabel: Record<FileStatus, string> = {
    ok:      "",
    broken:  "  [broken symlink]",
    missing: "  [missing]",
    drift:   "  [not a symlink — manually modified?]",
  };

  console.log(`\n${colors.bold(pkg)}`);
  let okCount = 0;
  for (const { source, target } of allFiles) {
    const s = checkFileStatus(source, target);
    console.log(`  ${statusIcon[s]} ${target}${colors.dim(statusLabel[s])}`);
    if (s === "ok") okCount++;
  }
  console.log(`  ${colors.dim(`${okCount}/${allFiles.length} linked`)}`);
  return okCount === allFiles.length;
}

async function showAllStatus(): Promise<boolean> {
  const pkgs = await listPackages();
  const host = detectHost();
  console.log(`\n${colors.dim(`host: ${host}`)}`);
  console.log(`${"Package".padEnd(22)} ${"Status".padEnd(14)} Files`);
  console.log("─".repeat(52));

  let allHealthy = true;
  let skippedHost = 0;
  for (const name of pkgs) {
    const pkgDir = join(PACKAGES_DIR, name);
    const meta = await getPackageMeta(name);
    if (meta && !appliesToHost(meta)) {
      skippedHost++;
      console.log(`  ${name.padEnd(20)} ${colors.dim("other host".padEnd(14))} ${colors.dim(`hosts=[${meta.hosts.join(", ")}]`)}`);
      continue;
    }
    const homeFiles = await collectFiles(pkgDir, "home");
    const systemFiles = await collectFiles(pkgDir, "system");
    const allFiles = [...homeFiles, ...systemFiles];
    if (allFiles.length === 0) continue;

    const counts: Record<FileStatus, number> = { ok: 0, broken: 0, missing: 0, drift: 0 };
    for (const { source, target } of allFiles) counts[checkFileStatus(source, target)]++;

    const allOk = counts.ok === allFiles.length;
    const noneOk = counts.ok === 0;
    const hasIssues = counts.broken > 0 || counts.drift > 0;
    if (hasIssues) allHealthy = false;

    const rawStatus = allOk ? "ok" : noneOk ? "not linked" : hasIssues ? "issues" : "partial";
    const paddedRaw = rawStatus.padEnd(14);
    const statusStr = allOk    ? colors.green(paddedRaw)
                    : noneOk   ? colors.dim(paddedRaw)
                    : hasIssues ? colors.red(paddedRaw)
                    :             colors.yellow(paddedRaw);

    const issues: string[] = [];
    if (counts.broken > 0) issues.push(`${counts.broken} broken`);
    if (counts.drift > 0) issues.push(`${counts.drift} drift`);
    if (counts.missing > 0 && !noneOk) issues.push(`${counts.missing} missing`);
    const detail = `${counts.ok}/${allFiles.length}` + (issues.length ? ` (${issues.join(", ")})` : "");

    console.log(`  ${name.padEnd(20)} ${statusStr} ${detail}`);
  }
  if (skippedHost > 0) console.log(`\n${colors.dim(`${skippedHost} package(s) excluded by host filter`)}`);
  console.log("");
  return allHealthy;
}

// ─── typed dispatch ───────────────────────────────────────────────────────────

const ACTIONS = ["info", "link", "unlink", "status", "configure", "enable", "disable"] as const;
type Action = typeof ACTIONS[number];

function isAction(s: string): s is Action {
  return (ACTIONS as readonly string[]).includes(s);
}

interface DispatchArgs {
  init?: string;
  dryRun: boolean;
  yes: boolean;
  force: boolean;
  ignoreHost: boolean;
}

// Each handler returns true on success, false on failure (drives exit code).
const HANDLERS: Record<Action, (pkg: string, a: DispatchArgs) => Promise<boolean>> = {
  info:      (pkg) => showPackageInfo(pkg),
  link:      (pkg, a) => linkPackage(pkg, { init: a.init, dryRun: a.dryRun, force: a.force, ignoreHost: a.ignoreHost }),
  unlink:    (pkg, a) => unlinkPackage(pkg, { init: a.init, dryRun: a.dryRun, skipConfirm: a.yes }),
  status:    (pkg) => showPackageStatus(pkg),
  configure: (pkg) => runConfigure(pkg),
  enable:    async (pkg, a) => { await runInitScript(pkg, "enable", a.init); return true; },
  disable:   async (pkg, a) => { await runInitScript(pkg, "disable", a.init); return true; },
};

async function dispatch(pkg: string, action: string, args: DispatchArgs): Promise<boolean> {
  if (!isAction(action)) {
    logError(`Unknown action "${action}". Valid: ${ACTIONS.join(", ")}`);
    return false;
  }
  return HANDLERS[action](pkg, args);
}

// ─── bulk helpers ────────────────────────────────────────────────────────────

function appliesToCurrentOS(meta: { os?: string[] }): boolean {
  if (!meta.os || meta.os.length === 0) return true;
  const distro = detectDistro();
  const osCategory = distro === "macos" ? "macos" : "linux";
  return meta.os.includes(osCategory) || meta.os.includes(distro);
}

async function collectAllPackages(ignoreHost: boolean): Promise<{
  included: string[];
  skippedHost: string[];
  skippedOS: string[];
  noFiles: string[];
}> {
  const host = detectHost();
  const allPkgs = await listPackages();
  const included: string[] = [];
  const skippedHost: string[] = [];
  const skippedOS: string[] = [];
  const noFiles: string[] = [];

  for (const name of allPkgs) {
    const pkgDir = join(PACKAGES_DIR, name);
    const meta = await getPackageMeta(name);
    if (meta && !appliesToCurrentOS(meta)) { skippedOS.push(name); continue; }
    if (!ignoreHost && meta && !appliesToHost(meta, host)) { skippedHost.push(name); continue; }
    const files = [...await collectFiles(pkgDir, "home"), ...await collectFiles(pkgDir, "system")];
    if (files.length === 0) { noFiles.push(name); continue; }
    included.push(name);
  }
  return { included, skippedHost, skippedOS, noFiles };
}

// ─── command ─────────────────────────────────────────────────────────────────

export const pkgCommand = defineCommand({
  meta: { description: "Manage dotfile packages" },
  args: {
    init: { type: "string", description: "Init system: runit or systemd" },
    "dry-run": { type: "boolean", description: "Preview without applying (link/unlink)" },
    yes: { type: "boolean", short: "y", description: "Skip confirmation (unlink only)" },
    force: { type: "boolean", description: "Allow link to overwrite real (non-symlink) files" },
    "ignore-host": { type: "boolean", description: "Link even if meta.hosts excludes this host" },
    tag: { type: "string", description: "Apply action to all packages with this tag" },
    all: { type: "boolean", description: "Apply action to every package matching current host/OS" },
  },
  async run({ args, rawArgs }) {
    const dispatchArgs: DispatchArgs = {
      init: args.init,
      dryRun: args["dry-run"] ?? false,
      yes: args.yes ?? false,
      force: args.force ?? false,
      ignoreHost: args["ignore-host"] ?? false,
    };

    if (args.all) {
      const positionals = rawArgs.filter((a) => !a.startsWith("-"));
      const action = positionals[0] ?? "link";

      const { included, skippedHost, skippedOS, noFiles } = await collectAllPackages(dispatchArgs.ignoreHost);

      if (included.length === 0) {
        logError("No packages matched current host/OS filters.");
        process.exit(1);
      }

      logSection(`dot pkg --all ${action}`);
      logInfo(`Host: ${detectHost()} | OS: ${detectDistro()}`);
      console.log(`\n${colors.bold("Packages to process")} (${included.length}):`);
      for (const name of included) console.log(`  ${colors.green("•")} ${name}`);
      if (skippedHost.length > 0)
        console.log(`\n${colors.dim(`Skipped (other host): ${skippedHost.join(", ")}`)}`);
      if (skippedOS.length > 0)
        console.log(`${colors.dim(`Skipped (other OS): ${skippedOS.join(", ")}`)}`);
      if (noFiles.length > 0)
        console.log(`${colors.dim(`Skipped (no files): ${noFiles.join(", ")}`)}`);
      console.log("");

      if (!dispatchArgs.dryRun && !dispatchArgs.yes) {
        const proceed = await confirm({ message: `${action} ${included.length} package(s)?` });
        if (!proceed) { logInfo("Aborted."); return; }
      }

      let ok = 0, failed = 0;
      for (const name of included) {
        const result = await dispatch(name, action, dispatchArgs);
        if (result) ok++; else failed++;
      }
      console.log("");
      if (failed === 0) logSuccess(`${ok} package(s) ${action}ed successfully.`);
      else logError(`${failed} package(s) failed, ${ok} succeeded.`);
      if (failed > 0) process.exit(1);
      return;
    }

    if (args.tag) {
      // Filter out the tag value from positionals (it's consumed by --tag)
      const positionals = rawArgs.filter((a) => !a.startsWith("-") && a !== args.tag);
      const action = positionals[0] ?? "link";

      const allPkgs = await listPackages();
      const tagged: string[] = [];
      const excludedByHost: string[] = [];
      for (const name of allPkgs) {
        const meta = await getPackageMeta(name);
        if (!meta?.tags.includes(args.tag!)) continue;
        if (!dispatchArgs.ignoreHost && !appliesToHost(meta)) {
          excludedByHost.push(name);
          continue;
        }
        tagged.push(name);
      }
      if (tagged.length === 0) {
        logError(`No packages found with tag "${args.tag}"${excludedByHost.length ? ` (${excludedByHost.length} excluded by host filter)` : ""}`);
        process.exit(1);
      }
      logInfo(`Packages tagged "${args.tag}" on host ${detectHost()}: ${tagged.join(", ")}`);
      if (excludedByHost.length > 0) {
        logWarn(`Excluded by host filter: ${excludedByHost.join(", ")} (use --ignore-host to include)`);
      }
      let allOk = true;
      for (const name of tagged) {
        if (!(await dispatch(name, action, dispatchArgs))) allOk = false;
      }
      if (!allOk) process.exit(1);
      return;
    }

    const positionals = rawArgs.filter((a) => !a.startsWith("-"));
    const [pkgName, action] = positionals;

    if (!pkgName) {
      const pkgs = await listPackages();
      console.log(`
Usage: dot pkg <package> [action] [flags]
       dot pkg status
       dot pkg --tag <tag> [action]
       dot pkg --all [action]

Actions:
  info        Show package metadata and file list (default)
  link        Symlink config files into place
  unlink      Remove symlinks
  status      Check symlink health
  configure   Run configure.sh
  enable      Enable service
  disable     Disable service

Flags:
  --init runit|systemd   Init system (auto-detected)
  --dry-run              Preview link/unlink changes
  --force                Allow link to overwrite real files (use with care)
  --ignore-host          Link even if meta.hosts excludes this host
  -y, --yes              Skip unlink confirmation
  --tag <tag>            Apply action to all packages with this tag
  --all                  Apply action to all packages for current host/OS

Available packages:
  ${pkgs.join("  ")}
`);
      return;
    }

    if (pkgName === "status" && !action) {
      const healthy = await showAllStatus();
      if (!healthy) process.exit(1);
      return;
    }

    if (!existsSync(join(PACKAGES_DIR, pkgName))) {
      logError(`Package "${pkgName}" not found`);
      process.exit(1);
    }

    const ok = await dispatch(pkgName, action ?? "info", dispatchArgs);
    if (!ok) process.exit(1);
  },
});
