import { commandExists, logInfo, logSection } from "../console.ts";
import { spawnInherit } from "../spawn.ts";
import type { Updater } from "./types.ts";

export const pipxUpdater: Updater = {
  name: "pipx",
  group: "global",
  async run(check) {
    if (!commandExists("pipx")) return true;
    if (check) { logInfo("pipx: listing packages…"); await spawnInherit(["pipx", "list"]); return true; }
    logSection("pipx");
    const r = await spawnInherit(["pipx", "upgrade-all"]);
    return r.exitCode === 0;
  },
};
