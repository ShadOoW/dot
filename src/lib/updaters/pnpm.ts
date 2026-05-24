import { commandExists, getVersion, logInfo, logSection } from "../console.ts";
import type { Updater } from "./types.ts";

export const pnpmUpdater: Updater = {
  name: "pnpm",
  group: "global",
  async run(check) {
    if (!commandExists("pnpm")) return true;
    if (check) { logInfo(`pnpm: ${getVersion("pnpm", ["--version"])}`); return true; }
    logSection("pnpm");
    const r = Bun.spawnSync(["pnpm", "update", "-g", "--latest"], { stdout: "inherit", stderr: "inherit" });
    return r.exitCode === 0;
  },
};
