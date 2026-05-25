import { commandExists, getVersion, logInfo, logSection } from "../console.ts";
import { spawnInherit } from "../spawn.ts";
import type { Updater } from "./types.ts";

export const denoUpdater: Updater = {
  name: "deno",
  group: "system",
  async run(check) {
    if (!commandExists("deno")) return true;
    if (check) { logInfo(`deno: ${getVersion("deno", ["--version"])}`); return true; }
    logSection("deno");
    const r = await spawnInherit(["deno", "upgrade"]);
    return r.exitCode === 0;
  },
};
