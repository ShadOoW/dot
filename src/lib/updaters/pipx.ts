import { commandExists, logInfo, logSection } from "../console.ts";
import type { Updater } from "./types.ts";

export const pipxUpdater: Updater = {
  name: "pipx",
  group: "global",
  async run(check) {
    if (!commandExists("pipx")) return true;
    if (check) { logInfo("pipx: listing packages…"); Bun.spawnSync(["pipx", "list"], { stdout: "inherit" }); return true; }
    logSection("pipx");
    const r = Bun.spawnSync(["pipx", "upgrade-all"], { stdout: "inherit", stderr: "inherit" });
    return r.exitCode === 0;
  },
};
