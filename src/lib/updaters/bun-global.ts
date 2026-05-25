import { existsSync } from "fs";
import { join } from "path";
import { HOME_DIR } from "../config.ts";
import { commandExists, getVersion, logInfo, logSection } from "../console.ts";
import { spawnInherit } from "../spawn.ts";
import type { Updater } from "./types.ts";

export const bunGlobalUpdater: Updater = {
  name: "bun-global",
  group: "global",
  async run(check) {
    if (!commandExists("bun")) return true;
    if (check) { logInfo(`bun -g: ${getVersion("bun", ["outdated", "-g"])}`); return true; }
    logSection("bun global");
    const lockfile = join(HOME_DIR, ".bun/install/global/bun.lock");
    if (existsSync(lockfile)) Bun.file(lockfile).delete();
    const r = await spawnInherit(["bun", "update", "-g"]);
    return r.exitCode === 0;
  },
};
