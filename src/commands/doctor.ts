import { defineCommand } from "citty";
import { appliesToHost, detectHost, getPackageMeta, listPackages } from "../lib/pkg.ts";
import { collectPackageStatus, type PackageStatus } from "../lib/status.ts";
import { colors, logError, logInfo, logSection, logSuccess } from "../lib/console.ts";
import { linkPackage } from "./link.ts";

function summarize(s: PackageStatus): string {
  const total = s.files.length;
  const parts: string[] = [`${s.counts.ok}/${total} linked`];
  if (s.counts.broken > 0) parts.push(colors.red(`${s.counts.broken} broken`));
  if (s.counts.drift > 0) parts.push(colors.yellow(`${s.counts.drift} drift`));
  if (s.counts.missing > 0 && s.counts.ok > 0) parts.push(colors.dim(`${s.counts.missing} missing`));
  return parts.join(", ");
}

export const doctorCommand = defineCommand({
  meta: { description: "Health-check every package: report broken symlinks and drift" },
  args: {
    verbose: { type: "boolean", short: "v", description: "Show details for every package, not just ones with issues" },
    quiet: { type: "boolean", short: "q", description: "Suppress per-package output; only print summary + issues" },
    "all-hosts": { type: "boolean", description: "Check packages from all hosts, not just the current one" },
    fix: { type: "boolean", description: "Re-link packages with broken symlinks or missing links" },
    force: { type: "boolean", description: "With --fix, overwrite real files (drift) instead of refusing" },
  },
  async run({ args }) {
    const pkgs = await listPackages();
    const host = detectHost();
    const statuses: PackageStatus[] = [];
    let excludedByHost = 0;
    for (const name of pkgs) {
      const meta = await getPackageMeta(name);
      if (!args["all-hosts"] && meta && !appliesToHost(meta)) {
        excludedByHost++;
        continue;
      }
      statuses.push(await collectPackageStatus(name));
    }
    if (!args.quiet) {
      console.log(`${colors.dim(`host: ${host}${excludedByHost ? `  (${excludedByHost} package(s) excluded — use --all-hosts to include)` : ""}`)}`);
    }

    const withFiles = statuses.filter((s) => s.files.length > 0);
    const withIssues = statuses.filter((s) => s.issues.length > 0);
    const unlinked = statuses.filter((s) => s.files.length > 0 && s.counts.ok === 0);
    const partial = statuses.filter(
      (s) => s.files.length > 0 && s.counts.ok > 0 && s.counts.ok < s.files.length && s.issues.length === 0,
    );
    const healthy = statuses.filter((s) => s.files.length > 0 && s.counts.ok === s.files.length);

    if (!args.quiet) {
      console.log(`\n${colors.bold("Health report")} — ${withFiles.length} packages with files\n`);

      if (withIssues.length === 0) {
        logSuccess("No broken symlinks or drift detected");
      } else {
        console.log(colors.red(`${withIssues.length} package(s) with issues:`));
        for (const s of withIssues) {
          console.log(`\n  ${colors.bold(s.name)}  ${colors.dim(summarize(s))}`);
          for (const issue of s.issues) {
            const icon = issue.status === "broken" ? colors.red("✗") : colors.yellow("~");
            const label = issue.status === "broken" ? "broken symlink" : "not a symlink (drift)";
            console.log(`    ${icon} ${issue.target}  ${colors.dim(`[${label}]`)}`);
            if (issue.status === "broken") console.log(`      ${colors.dim(`expected → ${issue.source}`)}`);
          }
        }
      }

      if (args.verbose) {
        if (healthy.length > 0) {
          console.log(`\n${colors.green("Healthy:")}`);
          for (const s of healthy) console.log(`  ${colors.green("✓")} ${s.name}  ${colors.dim(summarize(s))}`);
        }
        if (partial.length > 0) {
          console.log(`\n${colors.yellow("Partially linked:")}`);
          for (const s of partial) console.log(`  ${colors.yellow("~")} ${s.name}  ${colors.dim(summarize(s))}`);
        }
        if (unlinked.length > 0) {
          console.log(`\n${colors.dim("Not linked:")}`);
          for (const s of unlinked) console.log(`  ${colors.dim("·")} ${s.name}  ${colors.dim(summarize(s))}`);
        }
      }
    }

    console.log("");
    logInfo(
      `Summary: ${colors.green(`${healthy.length} healthy`)}, ` +
      `${colors.yellow(`${partial.length} partial`)}, ` +
      `${colors.dim(`${unlinked.length} not linked`)}, ` +
      `${colors.red(`${withIssues.length} with issues`)}`,
    );

    if (args.fix) {
      // Fix candidates: packages with broken/drift issues + partially-linked packages with missing files.
      // Fully unlinked packages are intentionally not linked — leave them alone.
      const toFix = [...new Set([...withIssues, ...partial])];
      if (toFix.length === 0) {
        logSuccess("Nothing to fix.");
        return;
      }

      logSection(`Fixing ${toFix.length} package(s)…`);
      let fixed = 0;
      let failed = 0;
      for (const s of toFix) {
        const ok = await linkPackage(s.name, { force: args.force });
        if (ok) fixed++;
        else failed++;
      }
      console.log("");
      logInfo(`Fixed: ${fixed} package(s)${failed ? `, ${failed} with remaining issues` : ""}`);
      if (failed > 0) process.exit(1);
      return;
    }

    if (withIssues.length > 0) {
      logError("Doctor found issues. Re-run with -v for full breakdown, then `dot pkg <name> link` to repair, or use --fix to repair automatically.");
      process.exit(1);
    }
  },
});
