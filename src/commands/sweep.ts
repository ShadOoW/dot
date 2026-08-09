import { defineCommand } from "citty";
import { confirm } from "@clack/prompts";
import { colors, commandExists, logInfo, logSection, logSuccess, logWarn } from "../lib/console.ts";
import { run } from "../lib/spawn.ts";
import { getPackageMeta, listPackages } from "../lib/pkg.ts";

// Sweep the three things that silently accumulate on a rolling-release box: config
// files a package upgrade could not merge, packages nothing depends on any more, and
// the download cache.
//
// ── Why this is a table and not a pile of if-distro ─────────────────────────────────
// The three concerns are identical on Arch and Void; only the command names differ. An
// earlier version of this file hardcoded pacman throughout, which on Void produced the
// worst possible outcome: the drift scan looked for `*.pacnew`, a marker Void never
// writes, so it printed "No config drift found in /etc." as a *confident* pass, and the
// next step threw ENOENT on `pacman -Qtdq` (`run` is Bun.spawn, which raises rather
// than returning 127) and took the rest of the sweep with it. So the one command whose
// job is trimming caches and orphans had never once run on the Void boot — which is
// exactly why 1.9 GB of stale xbps cache and an orphaned wlroots0.19 were sitting there
// when this was written.
//
// Keeping both systems side by side in one table makes an asymmetry visible instead of
// letting a second distro quietly fall through.

interface PkgSystem {
  label: string;
  /** Presence of this binary means the system is in use on this host. */
  probe: string;
  /** find(1) predicates matching the unmerged-config markers this system leaves. */
  driftPredicates: string[];
  driftHint: string;
  /** Prints one orphan package name per line. */
  listOrphans: string[];
  /**
   * Removes orphans. Void's `xbps-remove -o` finds them itself, so the names are not
   * passed through; pacman needs them as arguments.
   */
  removeOrphans: (orphans: string[]) => string[];
  trimCache: string[];
  trimPrompt: string;
}

const SYSTEMS: PkgSystem[] = [
  {
    label: "xbps",
    probe: "xbps-query",
    // Void appends the new version to the file it could not merge: foo.conf.new-1.2_3.
    driftPredicates: ["-name", "*.new-*"],
    driftHint: "Compare each with its live file and merge by hand. Update the dotfiles `etc-real/` copy if affected.",
    listOrphans: ["xbps-query", "-O"],
    removeOrphans: () => ["xbps-remove", "-yo"],
    trimCache: ["xbps-remove", "-yO"],
    trimPrompt: "Remove obsolete packages from /var/cache/xbps (xbps-remove -O)?",
  },
  {
    label: "pacman",
    probe: "pacman",
    driftPredicates: ["(", "-name", "*.pacnew", "-o", "-name", "*.pacsave", ")"],
    driftHint: "Use `pacdiff` or merge by hand. Update the dotfiles `etc-real/` copy if affected.",
    listOrphans: ["pacman", "-Qtdq"],
    removeOrphans: (orphans) => ["pacman", "-Rns", "--noconfirm", ...orphans],
    trimCache: ["paccache", "-rk2"],
    trimPrompt: "Trim the pacman cache to the 2 most recent versions of each package (paccache -rk2)?",
  },
];

/** doas is the lighter of the two and is what this host installs; sudo is the fallback. */
function privEscalate(): string {
  return commandExists("doas") ? "doas" : "sudo";
}

export const sweepCommand = defineCommand({
  meta: { description: "Sweep system cruft: unmerged config files, orphaned packages, and package caches" },
  args: {
    yes: { type: "boolean", short: "y", description: "Skip interactive confirmations" },
  },
  async run({ args }) {
    logSection("System Sweeper");

    const active = SYSTEMS.filter((s) => commandExists(s.probe));
    if (!active.length) {
      logWarn(`no supported package system found (looked for ${SYSTEMS.map((s) => s.probe).join(", ")})`);
      return;
    }
    // A machine dual-booting Arch and Void shares /boot and /home but not /etc or the
    // package databases, so only the running system's tooling is ever present here.
    logInfo(`package system: ${colors.blue(active.map((s) => s.label).join(", "))}`);

    const priv = privEscalate();

    for (const sys of active) {
      console.log();
      logInfo(colors.bold(`Checking for unmerged config files (${sys.label})`));
      const { stdout } = await run(["find", "/etc", "-type", "f", ...sys.driftPredicates]);
      const drifting = stdout.split("\n").filter(Boolean);
      if (drifting.length) {
        logWarn(colors.yellow(`Found ${drifting.length} unmerged config file(s):`));
        for (const f of drifting) console.log(colors.dim(`  ${f}`));
        console.log(colors.dim(`  ${sys.driftHint}`));
      } else {
        logSuccess(`No unmerged config files in /etc.`);
      }

      console.log();
      logInfo(colors.bold(`Checking for orphaned packages (${sys.label})`));
      const { stdout: orphanOut } = await run(sys.listOrphans);
      // xbps-query -O prints `name-version_revision`; pacman -Qtdq prints bare names.
      // Either way one line is one package, which is all the prompt needs.
      const orphans = orphanOut.split("\n").filter(Boolean);
      if (orphans.length) {
        logWarn(colors.yellow(`Found ${orphans.length} orphaned package(s): ${orphans.join(" ")}`));
        const remove =
          args.yes || (await confirm({ message: "Remove these orphaned packages?", initialValue: true }));
        if (remove) {
          const { exitCode, out } = await run([priv, ...sys.removeOrphans(orphans)]);
          if (exitCode === 0) logSuccess("Orphans removed.");
          else logWarn(`orphan removal failed (exit ${exitCode})${out ? `: ${out.split("\n")[0]}` : ""}`);
        } else {
          logInfo("Skipped orphan removal.");
        }
      } else {
        logSuccess("No orphaned packages found.");
      }

      console.log();
      logInfo(colors.bold(`Trimming the ${sys.label} cache`));
      if (!commandExists(sys.trimCache[0]!)) {
        logWarn(`${sys.trimCache[0]} not found — skipping cache trim`);
      } else {
        const trim = args.yes || (await confirm({ message: sys.trimPrompt, initialValue: true }));
        if (trim) {
          const { exitCode, out } = await run([priv, ...sys.trimCache]);
          if (exitCode === 0) logSuccess("Cache trimmed.");
          else logWarn(`cache trim failed (exit ${exitCode})${out ? `: ${out.split("\n")[0]}` : ""}`);
        } else {
          logInfo("Skipped cache trim.");
        }
      }
    }

    console.log();
    logInfo(colors.bold("Running package-specific cleanSteps"));
    const allPkgs = await listPackages();
    let ranSteps = 0;
    for (const pkg of allPkgs) {
      const meta = await getPackageMeta(pkg);
      if (!meta?.cleanSteps?.length) continue;
      ranSteps++;
      logInfo(`Cleaning ${colors.blue(pkg)}...`);
      for (const step of meta.cleanSteps) {
        console.log(colors.dim(`  $ ${step}`));
        if (args.yes || (await confirm({ message: `Run this step for ${pkg}?`, initialValue: true }))) {
          await run(["bash", "-c", step]);
        }
      }
    }
    if (ranSteps === 0) logInfo("No packages define cleanSteps in their meta.json.");

    console.log();
    logSuccess("System sweep complete.");
  },
});
