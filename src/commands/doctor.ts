import { defineCommand } from "citty";
import { appliesToHost, detectHost, detectInit, getPackageMeta, listPackages } from "../lib/pkg.ts";
import { checkFileStatus, collectPackageStatus, type PackageStatus } from "../lib/status.ts";
import { colors, logError, logInfo, logSection, logSuccess } from "../lib/console.ts";
import { serviceStatus, serviceStateLabel, serviceIcon } from "../lib/service.ts";
import { validateAllPackages } from "../lib/schema.ts";
import { linkPackage } from "./link.ts";
import { runInitScriptInternal } from "./info.ts";
import { findGhosts, findSystemGhosts, flattenGhosts, shortenPath, type GhostItem } from "../lib/ghosts.ts";
import { checkManagedLinks, linkManagedCaches } from "./cache.ts";
import { rm } from "fs/promises";

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
    package: { type: "positional", required: false, description: "Package to check (checks all if omitted)" },
    verbose: { type: "boolean", short: "v", description: "Show details for every package, not just ones with issues" },
    quiet: { type: "boolean", short: "q", description: "Suppress per-package output; only print summary + issues" },
    "all-hosts": { type: "boolean", description: "Check packages from all hosts, not just the current one" },
    fix: { type: "boolean", description: "Re-link packages with broken symlinks or missing links" },
    force: { type: "boolean", description: "With --fix, overwrite real files (drift) instead of refusing" },
    score: { type: "boolean", description: "Print health score (linked files / total expected) and exit" },
  },
  async run({ args }) {
    const allPkgs = await listPackages();
    const pkgs = args.package ? [args.package] : allPkgs;

    if (args.package && !allPkgs.includes(args.package)) {
      logError(`Package "${args.package}" not found`);
      process.exit(1);
    }

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
    if (!args.quiet && !args.package) {
      console.log(`${colors.dim(`host: ${host}${excludedByHost ? `  (${excludedByHost} package(s) excluded — use --all-hosts to include)` : ""}`)}`);
    }

    const init = detectInit() ?? "systemd";
    const serviceGroups = await Promise.all(statuses.map((s) => serviceStatus(s.name, init)));
    const services = serviceGroups.flat();
    const schemaIssues = await validateAllPackages();
    const schemaErrors = schemaIssues.filter((i) => i.level === "error");
    const failedServices = services.filter((s) => s.state === "failed" || s.state === "not-enabled");

    const withFiles = statuses.filter((s) => s.files.length > 0);
    const withIssues = statuses.filter((s) => s.issues.length > 0);
    const unlinked = statuses.filter((s) => s.files.length > 0 && s.counts.ok === 0);
    const partial = statuses.filter(
      (s) => s.files.length > 0 && s.counts.ok > 0 && s.counts.ok < s.files.length && s.issues.length === 0,
    );
    const healthy = statuses.filter((s) => s.files.length > 0 && s.counts.ok === s.files.length);

    const [ghosts, systemGhosts] = await Promise.all([findGhosts(), findSystemGhosts()]);
    const cacheLinks = checkManagedLinks();
    const brokenCacheLinks = cacheLinks.filter((l) => l.status !== "ok");

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
            const label = issue.status === "broken" ? "broken" : "drift";
            console.log(`    ${icon} ${shortenPath(issue.target)}  ${colors.dim(`[${label}]`)}`);
            if (issue.status === "broken") console.log(`      ${colors.dim(`→ ${shortenPath(issue.source)}`)}`);
          }
        }
      }

      if (partial.length > 0) {
        console.log(`\n${colors.yellow(`${partial.length} package(s) partially linked:`)}`);
        for (const s of partial) {
          console.log(`\n  ${colors.bold(s.name)}  ${colors.dim(summarize(s))}`);
          for (const { source, target } of s.files) {
            const st = checkFileStatus(source, target);
            if (st === "missing") {
              console.log(`    ${colors.yellow("?")} ${shortenPath(target)}  ${colors.dim("[not linked]")}`);
              console.log(`      ${colors.dim(`→ ${shortenPath(source)}`)}`);
            }
          }
        }
      }

      if (args.verbose) {
        if (healthy.length > 0) {
          console.log(`\n${colors.green("Healthy:")}`);
          for (const s of healthy) console.log(`  ${colors.green("✓")} ${s.name}  ${colors.dim(summarize(s))}`);
        }
        if (unlinked.length > 0) {
          console.log(`\n${colors.dim("Not linked:")}`);
          for (const s of unlinked) console.log(`  ${colors.dim("·")} ${s.name}  ${colors.dim(summarize(s))}`);
        }
      }
    }

    const allHomeGhosts = ghosts;
    const totalGhosts = allHomeGhosts.length + systemGhosts.length;

    if (!args.quiet && totalGhosts > 0) {
      console.log(`\n${colors.bold("Ghosts")} ${colors.dim("— broken links to deleted repo files")}`);

      const printGhost = (g: GhostItem, indent: number, scope?: "system") => {
        const prefix = "  ".repeat(indent);
        const short = shortenPath(g.path);
        if (g.type === "directory") {
          const count = flattenGhosts(g.children ?? []).length;
          console.log(`${prefix}  ${colors.red("✗")} ${colors.bold(short + "/")}  ${colors.dim(`${count} ghost${count !== 1 ? "s" : ""}`)}`);
          if (g.children) {
            for (const child of g.children) printGhost(child, indent + 1);
          }
        } else {
          const target = g.target ? `  ${colors.dim("→")} ${colors.dim(shortenPath(g.target))}` : "";
          const tag = scope === "system" ? `  ${colors.dim("[sys]")}` : "";
          console.log(`${prefix}  ${colors.red("✗")} ${short}${target}${tag}`);
        }
      };

      for (const g of allHomeGhosts) printGhost(g, 0);
      for (const g of systemGhosts) printGhost(g, 0, "system");
    }

    if (!args.quiet && brokenCacheLinks.length > 0) {
      console.log(`\n${colors.bold("Cache links")}  ${colors.dim("~/.cache/managed-*")}`);
      for (const l of brokenCacheLinks) {
        const icon = l.status === "conflict" ? colors.yellow("~") : colors.red("✗");
        console.log(`  ${icon} ${shortenPath(l.link)}  ${colors.dim(`[${l.status}]`)}`);
        console.log(`    ${colors.dim(`→ ${shortenPath(l.target)}`)}`);
      }
    }

    if (!args.quiet && services.length > 0) {
      console.log(`\n${colors.bold("Services")}  ${colors.dim(init)}`);
      const nameWidth = Math.max(28, ...services.map(s => `${s.pkg}:${s.name}`.length)) + 2;
      for (const svc of services) {
        const name = `${svc.pkg}:${svc.name}`.padEnd(nameWidth);
        const state = serviceStateLabel(svc.state).padEnd(12);
        const scope = colors.dim(svc.scope === "user" ? "user" : " sys");
        const detail = svc.detail ? `  ${colors.dim(svc.detail)}` : "";
        console.log(`  ${serviceIcon(svc.state)} ${name} ${state} ${scope}${detail}`);
      }
    }

    if (!args.quiet && schemaIssues.length > 0) {
      console.log(`\n${colors.bold("Schema")}`);
      for (const i of schemaIssues) {
        const icon = i.level === "error" ? colors.red("✗") : colors.yellow("!");
        const loc = i.path ? `${i.pkg} ${colors.dim(i.path)}` : i.pkg;
        console.log(`  ${icon} ${loc} — ${i.message}`);
      }
    }

    const totalFiles = withFiles.reduce((sum, s) => sum + s.files.length, 0);
    const totalOk = withFiles.reduce((sum, s) => sum + s.counts.ok, 0);
    const healthScore = totalFiles > 0 ? Math.round((totalOk / totalFiles) * 100) : 100;

    if (args.score) {
      const scoreColor = healthScore === 100 ? colors.green : healthScore >= 80 ? colors.yellow : colors.red;
      console.log(`\nHealth score: ${scoreColor(`${healthScore}%`)}  ${colors.dim(`(${totalOk}/${totalFiles} files linked)`)}`);
      process.exit(healthScore < 100 ? 1 : 0);
    }

    console.log("");
    const allHomeGhostsFlat = flattenGhosts(allHomeGhosts);
    const allGhostsFlat = [...allHomeGhostsFlat, ...systemGhosts];
    const scoreColor = healthScore === 100 ? colors.green : healthScore >= 80 ? colors.yellow : colors.red;
    logInfo(
      `Packages: ${colors.green(`${healthy.length} healthy`)}, ` +
      `${colors.yellow(`${partial.length} partial`)}, ` +
      `${colors.dim(`${unlinked.length} not linked`)}, ` +
      `${colors.red(`${withIssues.length} with issues`)}` +
      `  ${scoreColor(`[${healthScore}%]`)}`,
    );
    if (allGhostsFlat.length > 0) {
      const sysPart = systemGhosts.length > 0 ? `, ${systemGhosts.length} system` : "";
      logInfo(`Ghosts: ${colors.red(`${allHomeGhostsFlat.length} home${sysPart}`)} — run with --fix to prune`);
    }
    if (brokenCacheLinks.length > 0) {
      logInfo(`Cache links: ${colors.red(`${brokenCacheLinks.length} broken/missing`)} — run with --fix to repair`);
    }
    if (services.length > 0) {
      const running = services.filter((s) => s.state === "running").length;
      logInfo(`Services: ${colors.green(`${running} running`)}, ${colors.red(`${failedServices.filter(s => s.state === "failed").length} failed`)}, ${services.length} total`);
    }
    if (schemaIssues.length > 0) {
      const warns = schemaIssues.length - schemaErrors.length;
      logInfo(`Schema: ${colors.red(`${schemaErrors.length} error(s)`)}, ${colors.yellow(`${warns} warning(s)`)}`);
    }

    if (args.fix) {
      // 1. Fix Files
      const toFix = [...new Set([...withIssues, ...partial])];
      if (toFix.length > 0) {
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
      }

      // 2. Fix Services
      if (failedServices.length > 0) {
        logSection(`Fixing ${failedServices.length} service(s)…`);
        const pkgsToEnable = [...new Set(failedServices.map(s => s.pkg))];
        let fixedSvc = 0;
        for (const p of pkgsToEnable) {
          if (await runInitScriptInternal(p, "enable", init)) {
            fixedSvc++;
          }
        }
        logInfo(`Attempted to enable services for ${fixedSvc}/${pkgsToEnable.length} package(s).`);
      }

      // 3. Fix Ghosts
      if (allGhostsFlat.length > 0) {
        logSection(`Pruning ${allGhostsFlat.length} ghost(s)…`);
        let pruned = 0;
        for (const g of allGhostsFlat) {
          const isSystem = !g.path.startsWith(process.env.HOME ?? "/root");
          try {
            if (isSystem) {
              const args = g.type === "directory" ? ["-rf", g.path] : ["-f", g.path];
              const r = Bun.spawnSync(["sudo", "rm", ...args], { stdout: "ignore", stderr: "pipe" });
              if (r.exitCode !== 0) {
                logError(`Failed to prune ${shortenPath(g.path)}: ${new TextDecoder().decode(r.stderr).trim()}`);
                continue;
              }
            } else {
              await rm(g.path, { recursive: g.type === "directory" });
            }
            console.log(`  ${colors.red("removed")} ${shortenPath(g.path)}`);
            pruned++;
          } catch (e) {
            logError(`Failed to prune ${shortenPath(g.path)}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        logInfo(`Pruned ${pruned} ghost(s).`);
      }

      // 4. Fix cache links
      if (brokenCacheLinks.length > 0) {
        logSection(`Repairing ${brokenCacheLinks.length} managed-cache link(s)…`);
        const summary = await linkManagedCaches(false);
        logInfo(`Cache links: ${summary.created} created, ${summary.healed} healed${summary.conflicts ? `, ${summary.conflicts} conflict(s) left unresolved` : ""}`);
      }

      if (toFix.length === 0 && failedServices.length === 0 && allGhostsFlat.length === 0 && brokenCacheLinks.length === 0) {
        logSuccess("Nothing to fix.");
      }
      return;
    }

    if (withIssues.length > 0 || brokenCacheLinks.length > 0) {
      logError("Doctor found issues. Re-run with -v for full breakdown, then `dot pkg <name> link` / `dot cache link` to repair, or use --fix to repair automatically.");
      process.exit(1);
    }
    const realFailed = failedServices.filter(s => s.state === "failed");
    if (schemaErrors.length > 0 || realFailed.length > 0) {
      if (schemaErrors.length > 0) logError(`${schemaErrors.length} schema error(s) — fix the offending meta.json files.`);
      if (realFailed.length > 0) logError(`${realFailed.length} service(s) in failed state.`);
      process.exit(1);
    }
  },
});

