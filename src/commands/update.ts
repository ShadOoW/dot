import { defineCommand } from "citty";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { CACHE_DIR, HOME_DIR } from "../lib/config.ts";
import { commandExists, getVersion, logDesc, logInfo, logSection, logWarn } from "../lib/console.ts";
import { detectDistro } from "../lib/pkg.ts";
import { analyzeStep, captureInProcess } from "../lib/ai.ts";
import { runGroup } from "../lib/updaters/index.ts";
import type { StepCallback } from "../lib/updaters/index.ts";

// ─── helpers ─────────────────────────────────────────────────────────────────

async function withSudoLoop<T>(run: () => Promise<T>): Promise<T> {
  // Authenticate on the real terminal. Every privileged updater must run on this same
  // controlling terminal or it will miss the ticket — see `pty` in src/lib/spawn.ts.
  const init = Bun.spawnSync(["sudo", "-v"], { stdio: ["inherit", "inherit", "inherit"] });
  if (init.exitCode !== 0) throw new Error("sudo: authentication failed");
  // Refresh every 55s — well within the default 5-minute sudo timeout. `-n` so a lapsed
  // ticket fails fast here instead of blocking on a prompt nobody can see.
  const timer = setInterval(() => {
    Bun.spawnSync(["sudo", "-n", "-v"], { stdio: ["ignore", "ignore", "ignore"] });
  }, 55_000);
  try {
    return await run();
  } finally {
    clearInterval(timer);
  }
}

function kernelHint() {
  if (!commandExists("vkpurge")) return;
  const raw = Bun.spawnSync(["vkpurge", "list"], { stdout: "pipe", stderr: "pipe" });
  const all = new TextDecoder().decode(raw.stdout).trim().split("\n").filter(Boolean);
  const voidKernels = all.filter((k) => !k.startsWith("linux"));
  const toRemove = voidKernels.length - 2;
  if (toRemove > 0) {
    logWarn(`${toRemove} old Void kernel${toRemove > 1 ? "s" : ""} can be cleaned → run: dot kernel`);
  }
}

function showInfo() {
  console.log("\nRuntimes:");
  const tools: [string, string[]][] = [
    ["node", ["--version"]], ["fnm", ["--version"]], ["python3", ["--version"]],
    ["rustc", ["--version"]], ["go", ["version"]], ["deno", ["--version"]], ["bun", ["--version"]],
  ];
  for (const [cmd, args] of tools) {
    if (commandExists(cmd)) logInfo(`${cmd}: ${getVersion(cmd, args)}`);
  }
  // anyzig is a multiplexer, not a toolchain: it fetches whatever `minimum_zig_version` the
  // project's build.zig.zon names. Updating it never changes the compiler a build gets, so
  // reporting a bare "installed" here reads as a zig version and is exactly the wrong idea.
  if (existsSync(join(HOME_DIR, ".local/bin/zig"))) {
    const verFile = join(CACHE_DIR, "anyzig.version");
    const ver = existsSync(verFile) ? readFileSync(verFile, "utf8").trim() : "untracked";
    logInfo(`zig: anyzig ${ver} — compiler picked per project from build.zig.zon`);
  }

  console.log("\nPackage managers:");
  for (const pm of ["xbps-install", "flatpak", "npm", "bun", "yarn", "pnpm", "pipx", "cargo"]) {
    if (commandExists(pm)) logInfo(`  ${pm}`);
  }
}

async function withAI(useAI: boolean, run: (step?: StepCallback) => Promise<boolean>): Promise<boolean> {
  if (!useAI) return run();

  const findings: Array<{ name: string; bullets: string[] }> = [];

  const step: StepCallback = async (name, fn) => {
    const { ok, output } = await captureInProcess(fn);
    const bullets = await analyzeStep(output);
    if (bullets) findings.push({ name, bullets });
    return ok;
  };

  const ok = await run(step);

  logSection("AI Analysis");
  if (findings.length === 0) {
    logInfo("Everything is up to date.");
  } else {
    for (const { name, bullets } of findings) {
      console.log(`  ${name}:`);
      for (const b of bullets) logInfo(b);
    }
  }

  return ok;
}

// ─── subcommands ─────────────────────────────────────────────────────────────

const checkFlag = { type: "boolean" as const, description: "Show what would update without making changes" };
const aiFlag = { type: "boolean" as const, description: "Analyse output with AI after completion" };
const sudoloopFlag = { type: "boolean" as const, description: "Keep sudo credentials alive for the entire run (useful on slow connections)" };

export const systemUpdateCommand = defineCommand({
  meta: { description: "Update system packages (xbps/pacman+yay/brew, flatpak) and self-updating runtimes" },
  args: { check: checkFlag, ai: aiFlag, sudoloop: sudoloopFlag },
  async run({ args }) {
    const check = args.check ?? false;
    const body = async () => withAI(args.ai ?? false, async (step) => {
      const distro = detectDistro();
      const pm = distro === "void" ? "xbps" : distro === "arch" ? "pacman + yay" : distro === "macos" ? "brew" : "system packages";
      logDesc(`Updates system packages via ${pm}, flatpak, bun, deno, and rustup.`);
      const result = await runGroup("system", check, step);
      if (!check) kernelHint();
      return result;
    });
    const ok = (args.sudoloop ?? false) ? await withSudoLoop(body) : await body();
    if (!ok) process.exit(1);
  },
});

export const globalUpdateCommand = defineCommand({
  meta: { description: "Update global package manager packages (npm, bun, pipx, cargo…) and shell completions" },
  args: { check: checkFlag, ai: aiFlag },
  async run({ args }) {
    const check = args.check ?? false;
    const ok = await withAI(args.ai ?? false, async (step) => {
      logDesc("Updates global packages via npm, bun, yarn, pnpm, pipx, and cargo. Regenerates shell completions.");
      return runGroup("global", check, step);
    });
    if (!ok) process.exit(1);
  },
});

export const sourceUpdateCommand = defineCommand({
  meta: { description: "Update source/custom-built tools (pkgbuilds, fnm, anyzig, ly, zinit)" },
  args: { check: checkFlag, ai: aiFlag },
  async run({ args }) {
    const check = args.check ?? false;
    const ok = await withAI(args.ai ?? false, async (step) => {
      logDesc("Builds and updates source tools: pkgbuilds, fnm, anyzig, ly, and zinit.");
      logSection("source tools");
      return runGroup("source", check, step);
    });
    if (!ok) process.exit(1);
  },
});

export const updateCommand = defineCommand({
  meta: { description: "Update system and packages" },
  args: {
    all: { type: "boolean", description: "Update system + global + source" },
    check: checkFlag,
    info: { type: "boolean", description: "Show installed versions without updating" },
    ai: aiFlag,
    sudoloop: sudoloopFlag,
  },
  subCommands: {
    system: systemUpdateCommand,
    global: globalUpdateCommand,
    source: sourceUpdateCommand,
  },
  async run({ args, rawArgs }) {
    if (rawArgs.some((a: string) => !a.startsWith("-"))) return;
    if (args.info) { showInfo(); return; }
    if (args.all || args.check) {
      const check = args.check ?? false;
      const body = async () => withAI(args.ai ?? false, async (step) => {
        let ok = true;
        for (const group of ["system", "global", "source"] as const) {
          if (group === "source") logSection("source tools");
          if (!await runGroup(group, check, step)) ok = false;
        }
        if (!check) kernelHint();
        return ok;
      });
      const ok = (args.sudoloop ?? false) ? await withSudoLoop(body) : await body();
      if (!ok) process.exit(1);
      return;
    }
    console.log(`
Usage: dot update <subcommand> [--check]

Subcommands:
  system    Update xbps (Void) / pacman+yay (Arch), flatpak, bun, deno, rustup
  global    Update npm -g, bun -g, yarn, pnpm, pipx, cargo; regenerate shell completions
  source    Update pkgbuilds, fnm, anyzig, ly, zinit

Flags:
  --all        Run all three subcommands
  --check      Show what would update without making changes
  --info       Show currently installed versions
  --ai         Analyse output with AI after completion
  --sudoloop   Keep sudo credentials alive for the entire run (for slow connections)

Examples:
  dot update system
  dot update --all
  dot update --all --ai
  dot update --all --sudoloop
  dot update system --ai
  dot update --check
  dot update --info
`);
  },
});
