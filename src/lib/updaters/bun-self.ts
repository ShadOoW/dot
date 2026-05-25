import { commandExists, getVersion, logInfo, logSection } from "../console.ts";
import { spawnInherit } from "../spawn.ts";
import type { Updater } from "./types.ts";

export const bunSelfUpdater: Updater = {
  name: "bun",
  group: "system",
  async run(check) {
    if (!commandExists("bun")) return true;
    if (check) { logInfo(`bun: ${getVersion("bun", ["--version"])}`); return true; }
    logSection("bun");
    const r = await spawnInherit(["bun", "upgrade"]);
    return r.exitCode === 0;
  },
};
