import { existsSync } from "fs";
import { join } from "path";
import { PACKAGES_DIR } from "../lib/config.ts";
import { collectFiles, detectDistro, getPackageMeta, detectInit } from "../lib/pkg.ts";
import { colors, logError } from "../lib/console.ts";
import { serviceStatus, serviceStateLabel, serviceIcon, enableService, disableService, declaredServices, type Init } from "../lib/service.ts";

export async function showPackageInfo(pkg: string): Promise<boolean> {
  const pkgDir = join(PACKAGES_DIR, pkg);
  if (!existsSync(pkgDir)) {
    logError(`Package "${pkg}" not found`);
    return false;
  }

  const meta = await getPackageMeta(pkg);
  if (!meta) { logError(`Could not read package info for "${pkg}"`); return false; }

  console.log(`\n${colors.bold(pkg)}${meta.description ? ` — ${meta.description}` : ""}\n`);

  if (meta.tags.length > 0) {
    console.log(`${colors.dim("Tags:")}     ${meta.tags.join(", ")}`);
  }
  if (meta.os.length > 0) {
    console.log(`${colors.dim("OS:")}       ${meta.os.join(", ")}`);
  }
  if (meta.hosts.length > 0) {
    console.log(`${colors.dim("Hosts:")}    ${meta.hosts.join(", ")}`);
  }
  if (meta.tags.length > 0 || meta.os.length > 0 || meta.hosts.length > 0) console.log("");

  const init = detectInit();
  const services = await serviceStatus(pkg, init ?? "systemd");
  if (services.length > 0) {
    console.log(colors.cyan("Services:"));
    for (const svc of services) {
      const scope = svc.init === "systemd" ? `${svc.init}/${svc.scope}` : svc.init;
      const state = serviceStateLabel(svc.state).padEnd(12);
      console.log(`  ${serviceIcon(svc.state)} ${svc.name.padEnd(24)} ${state} ${colors.dim(`[${scope}] ${svc.detail}`)}`);
    }
    console.log("");
  }

  const distro = detectDistro();
  const distroPackages = meta.packages[distro] ?? meta.packages["linux"];
  const allDistros = Object.keys(meta.packages);

  if (distroPackages) {
    console.log(colors.yellow(`Packages (${distro}):`));
    for (const [pm, pkgs] of Object.entries(distroPackages)) {
      if (pkgs.length === 0) continue;
      console.log(`  ${colors.cyan(pm + ":")} ${pkgs.join("  ")}`);
    }
    console.log("");
  } else if (allDistros.length > 0) {
    for (const [d, pkgList] of Object.entries(meta.packages)) {
      console.log(colors.yellow(`Packages (${d}):`));
      for (const [pm, pkgs] of Object.entries(pkgList)) {
        if (pkgs.length === 0) continue;
        console.log(`  ${colors.cyan(pm + ":")} ${pkgs.join("  ")}`);
      }
    }
    console.log("");
  }

  console.log(colors.cyan("Operations:"));
  console.log(`  dot pkg ${pkg} link`);
  console.log(`  dot pkg ${pkg} unlink`);
  if (meta.configure) console.log(`  dot pkg ${pkg} configure`);
  for (const s of meta.enableScripts) {
    const hint = s.init ? ` --init ${s.init}` : "";
    console.log(`  dot pkg ${pkg} enable${hint}`);
  }
  console.log("");

  const homeFiles = await collectFiles(pkgDir, "home");
  const systemFiles = await collectFiles(pkgDir, "system");
  const allFiles = [...homeFiles, ...systemFiles];

  if (allFiles.length > 0) {
    console.log(colors.cyan("Files:"));
    for (const { source, target } of allFiles) {
      const rel = source.replace(pkgDir + "/", "");
      console.log(`  ${colors.dim(rel)} → ${target}`);
    }
    console.log("");
  }

  if (meta.cleanSteps.length > 0) {
    console.log(colors.yellow("Clean steps:"));
    for (const step of meta.cleanSteps) console.log(`  ${step}`);
    console.log("");
  }

  return true;
}

export async function runConfigure(pkg: string): Promise<boolean> {
  const scriptPath = join(PACKAGES_DIR, pkg, "configure.sh");
  if (!existsSync(scriptPath)) {
    logError(`No configure.sh found for "${pkg}"`);
    return false;
  }

  const r = Bun.spawnSync(["sudo", "-v"], { stdout: "ignore", stderr: "ignore" });
  if (r.exitCode !== 0) { logError("sudo required"); return false; }

  const proc = Bun.spawn(["bash", scriptPath], { stdout: "inherit", stderr: "inherit" });
  return (await proc.exited) === 0;
}

export async function runInitScript(pkg: string, action: "enable" | "disable", initArg?: string): Promise<void> {
  const ok = await runInitScriptInternal(pkg, action, initArg);
  if (!ok) process.exit(1);
}

export async function runInitScriptInternal(pkg: string, action: "enable" | "disable", initArg?: string): Promise<boolean> {
  const meta = await getPackageMeta(pkg);
  if (!meta) { logError(`Package "${pkg}" not found`); return false; }

  const init = (initArg as Init) ?? detectInit() ?? "systemd";
  const scripts = meta.enableScripts;

  // 1. Try specific script if it exists
  const found = scripts.find((s) => s.init === init || (!s.init && scripts.length === 1));
  if (found) {
    const scriptName = action === "disable" ? found.name.replace("enable-", "disable-") : found.name;
    const scriptPath = join(PACKAGES_DIR, pkg, `${scriptName}.sh`);
    if (existsSync(scriptPath)) {
      const isLaunchd = scriptName.includes("launchd");
      const cmd = isLaunchd ? ["bash", scriptPath] : ["sudo", "bash", scriptPath];
      const proc = Bun.spawn(cmd, { stdout: "inherit", stderr: "inherit" });
      return (await proc.exited) === 0;
    }
  }

  // 2. Fallback to generic service management if units exist
  const units = declaredServices(pkg, init);
  if (units.length > 0) {
    let allOk = true;
    for (const { name, scope } of units) {
      const ok = action === "enable"
        ? await enableService(pkg, name, init, scope)
        : await disableService(pkg, name, init, scope);
      if (!ok) allOk = false;
    }
    return allOk;
  }

  logError(`No ${action} script or services found for "${pkg}" (init: ${init})`);
  return false;
}

