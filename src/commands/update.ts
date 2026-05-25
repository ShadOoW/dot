import { defineCommand } from "citty";
import { existsSync } from "fs";
import { join } from "path";
import { HOME_DIR } from "../lib/config.ts";
import { commandExists, getVersion, logDesc, logInfo, logSection, logWarn } from "../lib/console.ts";
import { detectDistro } from "../lib/pkg.ts";
import { analyzeWithAI, captureInProcess } from "../lib/ai.ts";
import { runGroup } from "../lib/updaters/index.ts";

// ─── helpers ─────────────────────────────────────────────────────────────────

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
  if (existsSync(join(HOME_DIR, ".local/bin/zig"))) logInfo("zig: installed (anyzig)");

  console.log("\nPackage managers:");
  for (const pm of ["xbps-install", "flatpak", "npm", "bun", "yarn", "pnpm", "pipx", "cargo"]) {
    if (commandExists(pm)) logInfo(`  ${pm}`);
  }
}

async function withAI(useAI: boolean, run: () => Promise<boolean>): Promise<boolean> {
  if (!useAI) return run();
  const { ok, output } = await captureInProcess(run);
  await analyzeWithAI(output);
  return ok;
}

// ─── subcommands ─────────────────────────────────────────────────────────────

const checkFlag = { type: "boolean" as const, description: "Show what would update without making changes" };
const aiFlag = { type: "boolean" as const, description: "Analyse output with AI after completion" };

export const systemUpdateCommand = defineCommand({
  meta: { description: "Update system packages (xbps/pacman+yay/brew, flatpak) and self-updating runtimes" },
  args: { check: checkFlag, ai: aiFlag },
  async run({ args }) {
    const check = args.check ?? false;
    const ok = await withAI(args.ai ?? false, async () => {
      const distro = detectDistro();
      const pm = distro === "void" ? "xbps" : distro === "arch" ? "pacman + yay" : distro === "macos" ? "brew" : "system packages";
      logDesc(`Updates system packages via ${pm}, flatpak, bun, deno, and rustup.`);
      const result = await runGroup("system", check);
      if (!check) kernelHint();
      return result;
    });
    if (!ok) process.exit(1);
  },
});

export const globalUpdateCommand = defineCommand({
  meta: { description: "Update global package manager packages (npm, bun, pipx, cargo…) and shell completions" },
  args: { check: checkFlag, ai: aiFlag },
  async run({ args }) {
    const check = args.check ?? false;
    const ok = await withAI(args.ai ?? false, async () => {
      logDesc("Updates global packages via npm, bun, yarn, pnpm, pipx, and cargo. Regenerates shell completions.");
      return runGroup("global", check);
    });
    if (!ok) process.exit(1);
  },
});

export const sourceUpdateCommand = defineCommand({
  meta: { description: "Update source/custom-built tools (pkgbuilds, fnm, anyzig, ly, zinit)" },
  args: { check: checkFlag, ai: aiFlag },
  async run({ args }) {
    const check = args.check ?? false;
    const ok = await withAI(args.ai ?? false, async () => {
      logDesc("Builds and updates source tools: pkgbuilds, fnm, anyzig, ly, and zinit.");
      logSection("source tools");
      return runGroup("source", check);
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
      const ok = await withAI(args.ai ?? false, async () => {
        let ok = true;
        for (const group of ["system", "global", "source"] as const) {
          if (group === "source") logSection("source tools");
          if (!await runGroup(group, check)) ok = false;
        }
        if (!check) kernelHint();
        return ok;
      });
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
  --all     Run all three subcommands
  --check   Show what would update without making changes
  --info    Show currently installed versions
  --ai      Analyse output with AI after completion

Examples:
  dot update system
  dot update --all
  dot update --all --ai
  dot update system --ai
  dot update --check
  dot update --info
`);
  },
});
