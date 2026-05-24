import { confirm } from "@clack/prompts";
import { existsSync, lstatSync } from "fs";
import { mkdir, symlink, unlink } from "fs/promises";
import { dirname, join } from "path";
import { PACKAGES_DIR } from "../lib/config.ts";
import {
  appliesToHost,
  collectFiles,
  detectHost,
  detectInit,
  getPackageMeta,
  hasInitDirs,
  isAlreadyLinked,
} from "../lib/pkg.ts";
import { colors, logError, logInfo, logSuccess, logWarn } from "../lib/console.ts";

export interface LinkOptions {
  init?: string;
  dryRun?: boolean;
  force?: boolean;
  ignoreHost?: boolean;
}

export interface UnlinkOptions {
  init?: string;
  dryRun?: boolean;
  skipConfirm?: boolean;
}

async function ensureSudo(): Promise<boolean> {
  const r = Bun.spawnSync(["sudo", "-v"], { stdout: "ignore", stderr: "ignore" });
  return r.exitCode === 0;
}

function runSudo(args: string[]): { ok: boolean; stderr: string } {
  const r = Bun.spawnSync(["sudo", ...args], { stdout: "pipe", stderr: "pipe" });
  const stderr = new TextDecoder().decode(r.stderr).trim();
  return { ok: r.exitCode === 0, stderr };
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function describeTarget(target: string): string {
  try {
    const stat = lstatSync(target);
    if (stat.isDirectory()) return "real directory";
    if (stat.isFile()) return "real file";
    return "non-symlink";
  } catch {
    return "non-symlink";
  }
}

export async function linkPackage(pkg: string, options: LinkOptions = {}): Promise<boolean> {
  const { init: initOverride, dryRun = false, force = false, ignoreHost = false } = options;
  const pkgDir = join(PACKAGES_DIR, pkg);
  if (!existsSync(pkgDir)) {
    logError(`Package "${pkg}" not found in packages/`);
    return false;
  }

  const meta = await getPackageMeta(pkg);
  if (meta && meta.hosts.length > 0 && !appliesToHost(meta)) {
    if (ignoreHost) {
      logWarn(`${pkg}: meta.hosts=[${meta.hosts.join(", ")}] excludes current host (${detectHost()}) — linking anyway (--ignore-host)`);
    } else {
      logWarn(`${pkg}: restricted to hosts [${meta.hosts.join(", ")}], current host is "${detectHost()}" — skipping. Use --ignore-host to override.`);
      return true;
    }
  }

  const hasHome = existsSync(join(pkgDir, "home"));
  const hasSystem = existsSync(join(pkgDir, "system"));

  if (!hasHome && !hasSystem) {
    logWarn(`Package "${pkg}" has no home/ or system/ directory — nothing to link`);
    return true;
  }

  let resolvedInit = initOverride;
  if (hasSystem && !resolvedInit) {
    const { runit, systemd } = hasInitDirs(pkgDir);
    if (runit || systemd) {
      const detected = detectInit();
      if (detected) {
        resolvedInit = detected;
        logInfo(`${pkg}: auto-detected init system: ${detected}`);
      } else {
        logError(`Package "${pkg}" has init-specific configs. Specify --init:`);
        if (runit) console.error(`  dot pkg ${pkg} link --init runit`);
        if (systemd) console.error(`  dot pkg ${pkg} link --init systemd`);
        return false;
      }
    }
  }

  let sudoCached = false;
  let totalFailures = 0;

  if (hasHome) {
    const files = await collectFiles(pkgDir, "home");
    if (files.length > 0) {
      logInfo(`Linking home files for ${colors.bold(pkg)}…`);
      let newLinks = 0;
      let alreadyCount = 0;
      let skipped = 0;
      for (const { source, target } of files) {
        if (isAlreadyLinked(source, target)) {
          console.log(`  ${colors.dim("✓")} ${colors.dim(target)}`);
          alreadyCount++;
          continue;
        }
        if (existsSync(target) && !isSymlink(target) && !force) {
          logError(`  Refusing to clobber ${describeTarget(target)}: ${target} (use --force to override)`);
          skipped++;
          totalFailures++;
          continue;
        }
        if (dryRun) {
          const note = existsSync(target) && !isSymlink(target) ? colors.yellow(" (would overwrite real file)") : "";
          console.log(`  ${colors.cyan("would →")} ${target}${note}`);
          newLinks++;
          continue;
        }
        try {
          await mkdir(dirname(target), { recursive: true });
          if (existsSync(target)) {
            if (isSymlink(target)) {
              await unlink(target);
            } else if (force) {
              const stat = lstatSync(target);
              if (stat.isDirectory()) {
                logError(`  Cannot clobber real directory even with --force: ${target}`);
                skipped++;
                totalFailures++;
                continue;
              }
              await unlink(target);
            }
          }
          await symlink(source, target);
          console.log(`  ${colors.green("→")} ${target}`);
          newLinks++;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          logError(`  Failed to link ${target}: ${msg}`);
          totalFailures++;
        }
      }
      if (dryRun) {
        logInfo(`Would link ${newLinks} home file(s)${skipped ? `, ${skipped} blocked` : ""}`);
      } else if (newLinks === 0 && alreadyCount > 0 && skipped === 0) {
        logSuccess(`All ${alreadyCount} home file(s) already in place`);
      } else if (newLinks > 0) {
        const extras: string[] = [];
        if (alreadyCount > 0) extras.push(`${alreadyCount} already`);
        if (skipped > 0) extras.push(`${skipped} blocked`);
        const suffix = extras.length ? ` (${extras.join(", ")})` : "";
        logSuccess(`Linked ${newLinks} new home file(s)${suffix}`);
      } else if (skipped > 0) {
        logError(`No files linked: ${skipped} blocked by existing real files`);
      }
    }
  }

  if (hasSystem) {
    const files = await collectFiles(pkgDir, "system", resolvedInit);
    if (files.length > 0) {
      if (!dryRun && !sudoCached) {
        if (!(await ensureSudo())) {
          logError("sudo required for system files");
          return false;
        }
        sudoCached = true;
      }
      logInfo(`Linking system files for ${colors.bold(pkg)}…`);
      let newLinks = 0;
      let alreadyCount = 0;
      let skipped = 0;
      for (const { source, target } of files) {
        if (isAlreadyLinked(source, target)) {
          console.log(`  ${colors.dim("✓")} ${colors.dim(target)}`);
          alreadyCount++;
          continue;
        }
        if (existsSync(target) && !isSymlink(target) && !force) {
          logError(`  Refusing to clobber ${describeTarget(target)}: ${target} (use --force to override)`);
          skipped++;
          totalFailures++;
          continue;
        }
        if (dryRun) {
          const note = existsSync(target) && !isSymlink(target) ? colors.yellow(" (would overwrite real file)") : "";
          console.log(`  ${colors.cyan("would →")} ${target}${note}`);
          newLinks++;
          continue;
        }

        const mk = runSudo(["mkdir", "-p", dirname(target)]);
        if (!mk.ok) {
          logError(`  mkdir failed for ${dirname(target)}${mk.stderr ? `: ${mk.stderr}` : ""}`);
          totalFailures++;
          continue;
        }
        if (existsSync(target)) {
          if (isSymlink(target) || force) {
            const targetIsRealDir = !isSymlink(target) && (() => {
              try { return lstatSync(target).isDirectory(); } catch { return false; }
            })();
            if (targetIsRealDir && !force) {
              logError(`  Refusing to clobber real directory: ${target}`);
              skipped++;
              totalFailures++;
              continue;
            }
            const rm = runSudo(["rm", "-f", target]);
            if (!rm.ok) {
              logError(`  Failed to remove ${target}${rm.stderr ? `: ${rm.stderr}` : ""}`);
              totalFailures++;
              continue;
            }
          }
        }
        const ln = runSudo(["ln", "-s", source, target]);
        if (!ln.ok) {
          logError(`  ln failed for ${target}${ln.stderr ? `: ${ln.stderr}` : ""}`);
          totalFailures++;
          continue;
        }
        console.log(`  ${colors.green("→")} ${target}`);
        newLinks++;
      }
      if (dryRun) {
        logInfo(`Would link ${newLinks} system file(s)${skipped ? `, ${skipped} blocked` : ""}`);
      } else if (newLinks === 0 && alreadyCount > 0 && skipped === 0) {
        logSuccess(`All ${alreadyCount} system file(s) already in place`);
      } else if (newLinks > 0) {
        const extras: string[] = [];
        if (alreadyCount > 0) extras.push(`${alreadyCount} already`);
        if (skipped > 0) extras.push(`${skipped} blocked`);
        const suffix = extras.length ? ` (${extras.join(", ")})` : "";
        logSuccess(`Linked ${newLinks} new system file(s)${suffix}`);
      } else if (skipped > 0) {
        logError(`No system files linked: ${skipped} blocked`);
      }
    }
  }

  return totalFailures === 0;
}

export async function unlinkPackage(pkg: string, options: UnlinkOptions = {}): Promise<boolean> {
  const { init: initOverride, dryRun = false, skipConfirm = false } = options;
  const pkgDir = join(PACKAGES_DIR, pkg);
  if (!existsSync(pkgDir)) {
    logError(`Package "${pkg}" not found`);
    return false;
  }

  let resolvedInit = initOverride;
  if (!resolvedInit) {
    const { runit, systemd } = hasInitDirs(pkgDir);
    if (runit || systemd) resolvedInit = detectInit() ?? undefined;
  }

  const hasHome = existsSync(join(pkgDir, "home"));
  const hasSystem = existsSync(join(pkgDir, "system"));
  const homeFiles = hasHome ? await collectFiles(pkgDir, "home") : [];
  const systemFiles = hasSystem ? await collectFiles(pkgDir, "system", resolvedInit) : [];
  const allFiles = [...homeFiles, ...systemFiles];

  if (allFiles.length === 0) {
    logWarn(`No files to unlink for "${pkg}"`);
    return true;
  }

  const removable = allFiles.filter(({ target }) => isSymlink(target));
  const driftFiles = allFiles.filter(({ target }) => existsSync(target) && !isSymlink(target));

  if (removable.length === 0) {
    logWarn(`Nothing to unlink for "${pkg}": no symlinks present.`);
    if (driftFiles.length > 0) {
      logWarn(`${driftFiles.length} target(s) exist but are not symlinks — leaving them alone:`);
      for (const { target } of driftFiles) console.log(`  ${colors.yellow("~")} ${target}`);
    }
    return true;
  }

  console.log(`\n${dryRun ? "Would remove" : "Will remove"} ${removable.length} symlink(s) for ${colors.bold(pkg)}:`);
  for (const { target } of removable) {
    console.log(`  ${colors.red("✗")} ${target}`);
  }
  if (driftFiles.length > 0) {
    console.log(`\n${colors.yellow(`Skipping ${driftFiles.length} non-symlink target(s):`)}`);
    for (const { target } of driftFiles) console.log(`  ${colors.yellow("~")} ${target}`);
  }

  if (dryRun) {
    logInfo(`Would remove ${removable.length} symlink(s)${driftFiles.length ? `; ${driftFiles.length} non-symlink target(s) would be skipped` : ""}`);
    return true;
  }

  const answer = skipConfirm || await confirm({ message: "Proceed?" });
  if (!answer) { console.log("Cancelled."); return true; }

  let sudoCached = false;
  let removed = 0;
  let failures = 0;

  for (const { source, target } of removable) {
    try {
      if (!isSymlink(target)) continue;
      const isSystem = source.includes("/system/");
      if (isSystem) {
        if (!sudoCached) {
          if (!(await ensureSudo())) { logError("sudo required"); return false; }
          sudoCached = true;
        }
        const rm = runSudo(["rm", "-f", target]);
        if (!rm.ok) {
          logError(`Failed to remove ${target}${rm.stderr ? `: ${rm.stderr}` : ""}`);
          failures++;
          continue;
        }
      } else {
        await unlink(target);
      }
      console.log(`  ${colors.red("removed")} ${target}`);
      removed++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logError(`Failed to remove ${target}: ${msg}`);
      failures++;
    }
  }
  logSuccess(`Removed ${removed} symlink(s)${failures ? `, ${failures} failed` : ""}`);
  return failures === 0;
}
