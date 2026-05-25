import { commandExists, getVersion, logInfo, logSection } from "../console.ts";
import { spawnInherit } from "../spawn.ts";
import type { Updater } from "./types.ts";

export const xbpsUpdater: Updater = {
  name: "xbps",
  group: "system",
  async run(check) {
    if (!commandExists("xbps-install")) return true;
    if (check) { logInfo(`xbps: ${getVersion("xbps-query", ["--version"])}`); return true; }
    logSection("xbps");
    const r = await spawnInherit(["sudo", "xbps-install", "-Syu"]);
    return r.exitCode === 0;
  },
};
