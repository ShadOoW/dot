import { existsSync } from "fs";
import { mkdir, unlink } from "fs/promises";
import { join } from "path";
import { HOME_DIR } from "../config.ts";
import { commandExists, logInfo, logSection } from "../console.ts";
import type { Updater } from "./types.ts";

const COMPLETIONS_DIR = join(HOME_DIR, ".zsh/completions");
const ZCOMPDUMP_GLOB = join(HOME_DIR, ".zcompdump");

type CompletionSpec = {
  file: string;
  cmd: string[];
  condition?: () => boolean;
};

const SPECS: CompletionSpec[] = [
  {
    file: "_dot",
    cmd: ["dot", "completions", "zsh"],
  },
  {
    file: "_deno.zsh",
    cmd: ["deno", "completions", "zsh"],
    condition: () => commandExists("deno"),
  },
  {
    file: "_rustup",
    cmd: ["rustup", "completions", "zsh"],
    condition: () => commandExists("rustup"),
  },
];

export const completionsUpdater: Updater = {
  name: "shell completions",
  group: "global",
  async run(check) {
    const active = SPECS.filter((s) => !s.condition || s.condition());
    if (active.length === 0) return true;

    if (check) {
      for (const s of active) logInfo(`completions: would regenerate ${s.file}`);
      return true;
    }

    logSection("shell completions");
    await mkdir(COMPLETIONS_DIR, { recursive: true });

    let ok = true;
    for (const s of active) {
      const dest = join(COMPLETIONS_DIR, s.file);
      const r = Bun.spawnSync(s.cmd, { stdout: "pipe", stderr: "pipe" });
      if (r.exitCode !== 0) {
        const msg = new TextDecoder().decode(r.stderr).trim();
        logInfo(`  ✗ ${s.file}: ${msg || "command failed"}`);
        ok = false;
        continue;
      }
      await Bun.write(dest, r.stdout);
      logInfo(`  ✓ ${s.file}`);
    }

    // Clear compdump so the next shell startup rescans fpath
    for (const suffix of ["", ".zwc"]) {
      const f = ZCOMPDUMP_GLOB + suffix;
      if (existsSync(f)) await unlink(f);
    }

    return ok;
  },
};
