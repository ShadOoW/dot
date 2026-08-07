import { defineCommand } from "citty";
import { colors, logInfo, logSection, logSuccess, logWarn, logError } from "../lib/console.ts";
import { run } from "../lib/spawn.ts";
import { getPackageMeta, listPackages } from "../lib/pkg.ts";
import { confirm } from "@clack/prompts";
import { resolve } from "path";

export const sweepCommand = defineCommand({
  meta: { description: "Sweep system cruft: pacman orphans, pacnew drift, and package caches" },
  args: {
    yes: { type: "boolean", short: "y", description: "Skip interactive confirmations" },
  },
  async run({ args }) {
    logSection("System Sweeper");

    // 1. Pacnew / Pacsave Check
    logInfo(colors.bold("Checking for config drift (.pacnew / .pacsave)"));
    const { stdout: pacnewOut } = await run(["find", "/etc", "-type", "f", "-name", "*.pacnew", "-o", "-name", "*.pacsave"]);
    const pacnews = pacnewOut.split("\n").filter(Boolean);
    if (pacnews.length > 0) {
      logWarn(colors.yellow(`Found ${pacnews.length} drifting config files:`));
      pacnews.forEach(p => console.log(colors.dim(`  ${p}`)));
      console.log(colors.dim("  Use `pacdiff` or manually merge these. Remember to update dotfiles `etc-real/` if affected."));
    } else {
      logSuccess("No config drift found in /etc.");
    }

    console.log();

    // 2. Orphaned Packages
    logInfo(colors.bold("Checking for orphaned packages"));
    const { stdout: orphanOut, exitCode: orphanCode } = await run(["pacman", "-Qtdq"]);
    const orphans = orphanOut.split("\n").filter(Boolean);
    
    if (orphans.length > 0) {
      logWarn(colors.yellow(`Found ${orphans.length} orphaned packages: ${orphans.join(" ")}`));
      
      const shouldRemove = args.yes || await confirm({
        message: "Remove these orphaned packages?",
        initialValue: true,
      });

      if (shouldRemove) {
        logInfo("Removing orphans...");
        await run(["sudo", "pacman", "-Rns", "--noconfirm", ...orphans]);
        logSuccess("Orphans removed.");
      } else {
        logInfo("Skipped orphan removal.");
      }
    } else {
      logSuccess("No orphaned packages found.");
    }

    console.log();

    // 3. Pacman Cache (paccache)
    logInfo(colors.bold("Trimming pacman cache"));
    const { exitCode: paccacheCode } = await run(["paccache", "-d"]);
    // If it exists, let's run it. (pacman-contrib is required)
    if (paccacheCode !== 0 && paccacheCode !== 1) { // 1 means no work to do typically or no paccache
        // Let's actually execute it for real
    }
    
    const shouldCache = args.yes || await confirm({
      message: "Trim pacman cache to retain only the 2 most recent versions (paccache -rk2)?",
      initialValue: true,
    });
    
    if (shouldCache) {
      const { exitCode } = await run(["sudo", "paccache", "-rk2"]);
      if (exitCode === 0) {
        logSuccess("Pacman cache trimmed.");
      } else {
        logWarn("Failed to run paccache. Is pacman-contrib installed?");
      }
    } else {
      logInfo("Skipped pacman cache trim.");
    }

    console.log();
    
    // 4. Per-package cleanSteps
    logInfo(colors.bold("Running package-specific cleanSteps"));
    const allPkgs = await listPackages();
    let ranSteps = 0;
    
    for (const pkg of allPkgs) {
      const meta = await getPackageMeta(pkg);
      if (meta?.cleanSteps && meta.cleanSteps.length > 0) {
        ranSteps++;
        logInfo(`Cleaning ${colors.blue(pkg)}...`);
        for (const step of meta.cleanSteps) {
          console.log(colors.dim(`  $ ${step}`));
          if (args.yes || await confirm({ message: `Run this step for ${pkg}?`, initialValue: true })) {
            await run(["bash", "-c", step]);
          }
        }
      }
    }
    
    if (ranSteps === 0) {
      logInfo("No packages with cleanSteps defined in their meta.json.");
    }

    console.log();
    logSuccess("System sweep complete!");
  },
});
