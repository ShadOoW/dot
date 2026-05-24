import { existsSync } from "fs";
import { join } from "path";
import { PACKAGES_DIR } from "../lib/config.ts";
import { collectFiles, detectDistro, getPackageMeta } from "../lib/pkg.ts";
import { colors, logError } from "../lib/console.ts";

export async function showPackageInfo(pkg: string): Promise<void> {
  const pkgDir = join(PACKAGES_DIR, pkg);
  if (!existsSync(pkgDir)) {
    logError(`Package "${pkg}" not found`);
    process.exit(1);
  }

  const meta = await getPackageMeta(pkg);
  if (!meta) { logError(`Could not read package info for "${pkg}"`); process.exit(1); }

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
}

export async function runConfigure(pkg: string): Promise<void> {
  const scriptPath = join(PACKAGES_DIR, pkg, "configure.sh");
  if (!existsSync(scriptPath)) {
    logError(`No configure.sh found for "${pkg}"`);
    process.exit(1);
  }

  const r = Bun.spawnSync(["sudo", "-v"], { stdout: "ignore", stderr: "ignore" });
  if (r.exitCode !== 0) { logError("sudo required"); process.exit(1); }

  const proc = Bun.spawn(["bash", scriptPath], { stdout: "inherit", stderr: "inherit" });
  process.exit(await proc.exited);
}

export async function runInitScript(pkg: string, action: "enable" | "disable", init?: string): Promise<void> {
  const meta = await getPackageMeta(pkg);
  if (!meta) { logError(`Package "${pkg}" not found`); process.exit(1); }

  const scripts = meta.enableScripts;
  if (scripts.length === 0) {
    logError(`No ${action} script for "${pkg}"`);
    process.exit(1);
  }

  let scriptName: string;
  if (scripts.length === 1) {
    scriptName = scripts[0].name;
  } else {
    if (!init) {
      logError(`Multiple init systems available. Specify --init:`);
      for (const s of scripts) console.error(`  dot pkg ${pkg} ${action} --init ${s.init}`);
      process.exit(1);
    }
    const found = scripts.find((s) => s.init === init);
    if (!found) {
      logError(`Unknown init system "${init}". Available: ${scripts.map((s) => s.init).join(", ")}`);
      process.exit(1);
    }
    scriptName = found.name;
  }

  const baseName = action === "disable" ? scriptName.replace("enable-", "disable-") : scriptName;
  const scriptPath = join(PACKAGES_DIR, pkg, `${baseName}.sh`);
  if (!existsSync(scriptPath)) {
    logError(`Script not found: ${scriptPath}`);
    process.exit(1);
  }

  const proc = Bun.spawn(["sudo", "bash", scriptPath], { stdout: "inherit", stderr: "inherit" });
  process.exit(await proc.exited);
}

