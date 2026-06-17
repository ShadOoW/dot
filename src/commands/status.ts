import { defineCommand } from "citty";
import { appliesToHost, detectDistro, detectHost, detectInit, getPackageMeta, listPackages } from "../lib/pkg.ts";
import { collectPackageStatus } from "../lib/status.ts";
import { colors, logInfo, logSection } from "../lib/console.ts";
import { serviceStatus, serviceIcon } from "../lib/service.ts";
import { findGhosts, findSystemGhosts, flattenGhosts } from "../lib/ghosts.ts";

export const statusCommand = defineCommand({
  meta: { description: "Dashboard: package health, services, and ghosts at a glance" },
  args: {
    "all-hosts": { type: "boolean", description: "Include packages for all hosts, not just the current one" },
  },
  async run({ args }) {
    const host = detectHost();
    const distro = detectDistro();
    const init = detectInit() ?? "systemd";

    logSection(`dot status — ${host}  ${colors.dim(`${distro} / ${init}`)}`);

    // ── packages ────────────────────────────────────────────────────────────
    const allPkgs = await listPackages();
    const statuses = [];
    let excluded = 0;
    for (const name of allPkgs) {
      const meta = await getPackageMeta(name);
      if (!args["all-hosts"] && meta && !appliesToHost(meta)) { excluded++; continue; }
      statuses.push(await collectPackageStatus(name));
    }

    const withFiles = statuses.filter((s) => s.files.length > 0);
    const healthy   = withFiles.filter((s) => s.counts.ok === s.files.length);
    const partial   = withFiles.filter((s) => s.counts.ok > 0 && s.counts.ok < s.files.length && s.issues.length === 0);
    const broken    = withFiles.filter((s) => s.issues.length > 0);
    const unlinked  = withFiles.filter((s) => s.counts.ok === 0);

    const totalFiles = withFiles.reduce((n, s) => n + s.files.length, 0);
    const totalOk    = withFiles.reduce((n, s) => n + s.counts.ok, 0);
    const score      = totalFiles > 0 ? Math.round((totalOk / totalFiles) * 100) : 100;
    const scoreColor = score === 100 ? colors.green : score >= 80 ? colors.yellow : colors.red;

    console.log(`\n${colors.bold("Packages")}  ${colors.dim(`${withFiles.length} with files${excluded ? `, ${excluded} excluded` : ""}`)}`);
    console.log(`  ${colors.green("✓")} ${healthy.length} healthy`);
    if (partial.length > 0)  console.log(`  ${colors.yellow("~")} ${partial.length} partial`);
    if (broken.length > 0)   console.log(`  ${colors.red("✗")} ${broken.length} with issues`);
    if (unlinked.length > 0) console.log(`  ${colors.dim("·")} ${unlinked.length} not linked`);
    console.log(`  ${scoreColor(`${score}%`)} ${colors.dim(`of files linked  (${totalOk}/${totalFiles})`)}`);

    if (partial.length > 0) {
      console.log(`\n  ${colors.yellow("Partially linked:")}`);
      for (const s of partial)
        console.log(`    ${colors.yellow("~")} ${s.name}  ${colors.dim(`${s.counts.ok}/${s.files.length}`)}`);
    }
    if (broken.length > 0) {
      console.log(`\n  ${colors.red("Issues:")}`);
      for (const s of broken)
        console.log(`    ${colors.red("✗")} ${s.name}  ${colors.dim(s.issues.map(i => i.status).join(", "))}`);
    }

    // ── ghosts ──────────────────────────────────────────────────────────────
    const [homeGhosts, sysGhosts] = await Promise.all([findGhosts(), findSystemGhosts()]);
    const homeFlat = flattenGhosts(homeGhosts);
    const totalGhosts = homeFlat.length + sysGhosts.length;
    if (totalGhosts > 0) {
      console.log(`\n${colors.bold("Ghosts")}  ${colors.red(`${totalGhosts} broken links`)}  ${colors.dim("— run `dot doctor --fix` to prune")}`);
      if (homeFlat.length > 0) console.log(`  ${colors.dim(`${homeFlat.length} home`)}`);
      if (sysGhosts.length > 0) console.log(`  ${colors.dim(`${sysGhosts.length} system`)}`);
    }

    // ── services ────────────────────────────────────────────────────────────
    const serviceGroups = await Promise.all(statuses.map((s) => serviceStatus(s.name, init)));
    const services = serviceGroups.flat();
    if (services.length > 0) {
      const running = services.filter((s) => s.state === "running").length;
      const failed  = services.filter((s) => s.state === "failed").length;
      const disabled = services.filter((s) => s.state === "not-enabled").length;

      console.log(`\n${colors.bold("Services")}  ${colors.dim(init)}`);
      console.log(`  ${colors.green("●")} ${running} running`);
      if (failed > 0)  console.log(`  ${colors.red("✗")} ${failed} failed`);
      if (disabled > 0) console.log(`  ${colors.dim("·")} ${disabled} not enabled`);

      const bad = services.filter((s) => s.state === "failed" || s.state === "not-enabled");
      if (bad.length > 0) {
        for (const svc of bad)
          console.log(`    ${serviceIcon(svc.state)} ${svc.pkg}:${svc.name}  ${colors.dim(svc.state)}`);
      }
    }

    console.log("");

    // ── quick hint ──────────────────────────────────────────────────────────
    const hints: string[] = [];
    if (broken.length > 0 || partial.length > 0) hints.push("dot doctor --fix");
    if (totalGhosts > 0) hints.push("dot doctor --fix");
    if (hints.length > 0)
      logInfo(`Run ${[...new Set(hints)].join(" or ")} to repair`);
  },
});
