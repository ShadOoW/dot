import { commandExists, getVersion, logInfo, logSection } from "../console.ts";
import { spawnInherit } from "../spawn.ts";
import type { Updater } from "./types.ts";

export const flatpakUpdater: Updater = {
  name: "flatpak",
  group: "system",
  async run(check) {
    if (!commandExists("flatpak")) return true;
    if (check) { logInfo(`flatpak: ${getVersion("flatpak", ["--version"])}`); return true; }
    logSection("flatpak");
    const r = await spawnInherit(["flatpak", "update", "-y"]);
    return r.exitCode === 0;
  },
};
