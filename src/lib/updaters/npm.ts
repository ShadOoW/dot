import { commandExists, getVersion, logInfo, logSection } from "../console.ts";
import { spawnInherit } from "../spawn.ts";
import type { Updater } from "./types.ts";

export const npmUpdater: Updater = {
  name: "npm",
  group: "global",
  async run(check) {
    if (!commandExists("npm")) return true;
    if (check) { logInfo(`npm: ${getVersion("npm", ["--version"])}`); return true; }
    logSection("npm");
    const r = await spawnInherit(["npm", "update", "-g"]);
    return r.exitCode === 0;
  },
};
