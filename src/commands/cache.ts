import { defineCommand } from "citty";
import { existsSync, lstatSync, realpathSync } from "fs";
import { mkdir, readdir, rm, symlink } from "fs/promises";
import { dirname, join } from "path";
import { HOME_DIR } from "../lib/config.ts";
import { commandExists, logDesc, logInfo, logSection, logSuccess, logWarn } from "../lib/console.ts";
import { analyzeWithAI, captureAndStream, CACHE_SYSTEM_PROMPT } from "../lib/ai.ts";

// ─── cleaners ────────────────────────────────────────────────────────────────

async function cleanXbps(): Promise<boolean> {
  if (!commandExists("xbps-install")) return true;
  logSection("xbps");
  const p = commandExists("doas") ? "doas" : "sudo";
  Bun.spawnSync([p, "xbps-remove", "-O"], { stdout: "inherit", stderr: "inherit" });
  return true;
}

async function cleanPacman(): Promise<boolean> {
  if (!commandExists("pacman")) return true;
  logSection("pacman");
  const p = commandExists("doas") ? "doas" : "sudo";
  // remove leftover incomplete download temp files so paccache doesn't emit fd errors
  Bun.spawnSync(
    [p, "find", "/var/cache/pacman/pkg", "-maxdepth", "1", "-name", "download-*", "-delete"],
    { stdout: "pipe", stderr: "pipe" }
  );
  if (commandExists("paccache")) {
    Bun.spawnSync([p, "paccache", "-rk1"], { stdout: "inherit", stderr: "inherit" });
    Bun.spawnSync([p, "paccache", "-ruk0"], { stdout: "inherit", stderr: "inherit" });
  } else {
    Bun.spawnSync([p, "pacman", "-Sc", "--noconfirm"], { stdout: "inherit", stderr: "inherit" });
  }
  return true;
}

async function cleanYay(): Promise<boolean> {
  if (!commandExists("yay")) return true;
  logSection("yay");
  Bun.spawnSync(["yay", "-Sc", "--noconfirm"], { stdout: "inherit", stderr: "inherit" });
  return true;
}

async function cleanFlatpak(): Promise<boolean> {
  if (!commandExists("flatpak")) return true;
  logSection("flatpak");
  Bun.spawnSync(["flatpak", "uninstall", "--unused", "-y"], { stdout: "inherit", stderr: "inherit" });
  return true;
}

async function cleanGo(): Promise<boolean> {
  if (!commandExists("go")) return true;
  logSection("go");
  Bun.spawnSync(["go", "clean", "-cache", "-testcache", "-fuzzcache", "-modcache"], { stdout: "inherit", stderr: "inherit" });
  return true;
}

async function cleanRustup(): Promise<boolean> {
  const rustupHome = process.env.RUSTUP_HOME ?? join(HOME_DIR, ".rustup");
  if (!existsSync(rustupHome)) return true;
  logSection("rustup");
  for (const dir of ["downloads", "tmp"]) {
    const p = join(rustupHome, dir);
    if (existsSync(p)) {
      await rm(p, { recursive: true, force: true });
      await mkdir(p, { recursive: true });
      logInfo(`${dir} cleared`);
    }
  }
  return true;
}

async function cleanStack(): Promise<boolean> {
  const stackRoot = process.env.STACK_ROOT ?? join(HOME_DIR, ".stack");
  if (!existsSync(stackRoot)) return true;
  logSection("stack");
  const pantry = join(stackRoot, "pantry");
  if (existsSync(pantry)) {
    await rm(pantry, { recursive: true, force: true });
    logInfo("pantry cleared");
  }
  return true;
}

async function cleanCargo(): Promise<boolean> {
  if (!commandExists("cargo")) return true;
  logSection("cargo");
  if (!commandExists("cargo-cache")) {
    logWarn("cargo-cache not found — install with: cargo install cargo-cache");
    return true;
  }
  Bun.spawnSync(["cargo", "cache", "--autoclean"], { stdout: "inherit", stderr: "inherit" });
  return true;
}

async function cleanNpm(): Promise<boolean> {
  if (!commandExists("npm")) return true;
  logSection("npm");
  Bun.spawnSync(["npm", "cache", "clean", "--force"], { stdout: "inherit", stderr: "inherit" });
  return true;
}

async function cleanBun(): Promise<boolean> {
  if (!commandExists("bun")) return true;
  logSection("bun");
  const cacheDir = process.env.BUN_INSTALL_CACHE_DIR ?? join(HOME_DIR, ".bun", "install", "cache");
  if (!existsSync(cacheDir)) return true;
  const realDir = realpathSync(cacheDir);
  for (const entry of await readdir(realDir)) {
    await rm(join(realDir, entry), { recursive: true, force: true });
  }
  logSuccess(`${realDir} cleared`);
  return true;
}

async function cleanPip(): Promise<boolean> {
  const pip = commandExists("pip") ? "pip" : commandExists("pip3") ? "pip3" : null;
  if (!pip) return true;
  logSection("pip");
  Bun.spawnSync([pip, "cache", "purge"], { stdout: "inherit", stderr: "inherit" });
  return true;
}

async function cleanUv(): Promise<boolean> {
  if (!commandExists("uv")) return true;
  logSection("uv");
  Bun.spawnSync(["uv", "cache", "clean"], { stdout: "inherit", stderr: "inherit" });
  return true;
}

async function cleanGradle(): Promise<boolean> {
  const gradleHome = process.env.GRADLE_USER_HOME ?? join(HOME_DIR, ".gradle");
  if (!existsSync(gradleHome)) return true;
  logSection("gradle");
  if (commandExists("gradle")) {
    Bun.spawnSync(["gradle", "--stop"], { stdout: "pipe", stderr: "pipe" });
  }
  const cachesDir = join(gradleHome, "caches");
  if (existsSync(cachesDir)) {
    const entries = await readdir(cachesDir);
    for (const entry of entries) {
      // build-cache: regenerable build artifacts; journal: internal bookkeeping
      if (entry.startsWith("build-cache") || entry.startsWith("journal")) {
        await rm(join(cachesDir, entry), { recursive: true, force: true });
        logInfo(`caches/${entry} removed`);
      }
    }
  }
  const daemonDir = join(gradleHome, "daemon");
  if (existsSync(daemonDir)) {
    await rm(daemonDir, { recursive: true, force: true });
    logInfo("daemon logs removed");
  }
  return true;
}

async function cleanDocker(): Promise<boolean> {
  if (!commandExists("docker")) return true;
  const ping = Bun.spawnSync(["docker", "info"], { stdout: "ignore", stderr: "ignore" });
  if (ping.exitCode !== 0) return true;
  logSection("docker");
  Bun.spawnSync(["docker", "system", "prune", "-f"], { stdout: "inherit", stderr: "inherit" });
  return true;
}

// ─── registry ────────────────────────────────────────────────────────────────

type Cleaner = { name: string; run: () => Promise<boolean> };

const CLEANERS: Cleaner[] = [
  { name: "xbps",    run: cleanXbps },
  { name: "pacman",  run: cleanPacman },
  { name: "yay",     run: cleanYay },
  { name: "flatpak", run: cleanFlatpak },
  { name: "go",      run: cleanGo },
  { name: "rustup",  run: cleanRustup },
  { name: "stack",   run: cleanStack },
  { name: "cargo",   run: cleanCargo },
  { name: "npm",     run: cleanNpm },
  { name: "bun",     run: cleanBun },
  { name: "pip",     run: cleanPip },
  { name: "uv",      run: cleanUv },
  { name: "gradle",  run: cleanGradle },
  { name: "docker",  run: cleanDocker },
];

// ─── links ───────────────────────────────────────────────────────────────────

type Link = { link: string; target: string };

const MANAGED = join(HOME_DIR, ".cache");

const LINKS: Link[] = [
  { link: join(HOME_DIR, ".bun/install/cache"),       target: join(MANAGED, "managed-bun/install/cache") },
  { link: join(HOME_DIR, ".cargo"),                   target: join(MANAGED, "managed-cargo") },
  { link: join(HOME_DIR, ".gradle"),                  target: join(MANAGED, "managed-gradle") },
  { link: join(HOME_DIR, ".m2"),                      target: join(MANAGED, "managed-maven") },
  { link: join(HOME_DIR, ".local/share/NuGet"),       target: join(MANAGED, "managed-nuget") },
  { link: join(HOME_DIR, ".local/share/Steam"),       target: join(MANAGED, "managed-steam/Steam") },
];

type LinkResult = "linked" | "already" | "conflict";

async function ensureLink({ link, target }: Link): Promise<LinkResult> {
  if (existsSync(link)) {
    if (lstatSync(link).isSymbolicLink()) return "already";
    logWarn(`${link} — exists as a real path, remove it manually before linking`);
    return "conflict";
  }
  await mkdir(dirname(link), { recursive: true });
  await symlink(target, link);
  return "linked";
}

// ─── subcommands ─────────────────────────────────────────────────────────────

async function withAI(rawArgs: string[], run: () => Promise<boolean>): Promise<boolean> {
  if (!rawArgs.includes("--ai")) return run();
  const filteredArgs = rawArgs.filter((a) => a !== "--ai");
  const cmdArgs = [process.execPath, process.argv[1], "cache", "clean", ...filteredArgs];
  const output = await captureAndStream(cmdArgs);
  await analyzeWithAI(output, CACHE_SYSTEM_PROMPT);
  return true;
}

const cleanCommand = defineCommand({
  meta: { description: "Clean tool caches (skips tools not installed on this system)" },
  args: { ai: { type: "boolean" as const, description: "Analyse output with AI after completion" } },
  async run({ rawArgs }) {
    const ok = await withAI(rawArgs, async () => {
      logDesc("Cleans caches for all installed tools. Skips anything not present.");
      let ok = true;
      for (const c of CLEANERS) {
        if (!await c.run()) ok = false;
      }
      return ok;
    });
    if (!ok) process.exit(1);
  },
});

const linkCommand = defineCommand({
  meta: { description: "Create symlinks from default tool locations to managed-cache dirs" },
  async run() {
    logDesc("Linking managed cache directories…");
    let created = 0;
    let already = 0;
    for (const entry of LINKS) {
      const result = await ensureLink(entry);
      if (result === "linked") {
        logSuccess(`${entry.link} → ${entry.target}`);
        created++;
      } else if (result === "already") {
        logSuccess(entry.link);
        already++;
      }
    }
    console.log();
    if (created === 0 && already > 0) {
      logInfo(`All ${already} link(s) already in place`);
    } else if (created > 0) {
      logInfo(`${created} link(s) created, ${already} already in place`);
    }
  },
});

// ─── parent command ───────────────────────────────────────────────────────────

export const cacheCommand = defineCommand({
  meta: { description: "Manage ~/.cache/managed-* caches" },
  subCommands: {
    clean: cleanCommand,
    link: linkCommand,
  },
});
