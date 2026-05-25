import { commandExists, getVersion, logInfo, logSection } from "../console.ts";
import { spawnInherit } from "../spawn.ts";
import type { Updater } from "./types.ts";

export const pnpmUpdater: Updater = {
  name: "pnpm",
  group: "global",
  async run(check) {
    if (!commandExists("pnpm")) return true;
    if (check) { logInfo(`pnpm: ${getVersion("pnpm", ["--version"])}`); return true; }
    logSection("pnpm");
    const r = await spawnInherit(["pnpm", "update", "-g", "--latest"]);
    return r.exitCode === 0;
  },
};
