import { existsSync } from "fs";
import { join } from "path";
import { HOME_DIR } from "../config.ts";
import { commandExists, logInfo, logSection } from "../console.ts";
import { spawnInherit } from "../spawn.ts";
import type { Updater } from "./types.ts";

export const yarnUpdater: Updater = {
  name: "yarn",
  group: "global",
  async run(check) {
    if (!commandExists("yarn")) return true;
    if (check) { logInfo("yarn: checking global packages…"); return true; }
    logSection("yarn");
    const lockfile = join(HOME_DIR, ".config/yarn/global/yarn.lock");
    if (existsSync(lockfile)) Bun.file(lockfile).delete();
    const r = await spawnInherit(["yarn", "global", "upgrade", "--latest"]);
    return r.exitCode === 0;
  },
};
