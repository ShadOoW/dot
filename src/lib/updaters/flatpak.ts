import { commandExists, getVersion, logInfo, logSection } from "../console.ts";
import type { Updater } from "./types.ts";

export const flatpakUpdater: Updater = {
  name: "flatpak",
  group: "system",
  async run(check) {
    if (!commandExists("flatpak")) return true;
    if (check) { logInfo(`flatpak: ${getVersion("flatpak", ["--version"])}`); return true; }
    logSection("flatpak");
    const r = Bun.spawnSync(["flatpak", "update", "-y"], { stdout: "inherit", stderr: "inherit" });
    return r.exitCode === 0;
  },
};
