import { commandExists, getVersion, logInfo, logSection } from "../console.ts";
import { spawnInherit } from "../spawn.ts";
import type { Updater } from "./types.ts";

export const yayUpdater: Updater = {
  name: "yay",
  group: "system",
  async run(check) {
    if (!commandExists("yay")) return true;
    if (check) { logInfo(`yay: ${getVersion("yay", ["--version"])}`); return true; }
    logSection("yay");
    const r = await spawnInherit(["yay", "-Sau", "--noconfirm", "--sudoloop"], { pty: false });
    return r.exitCode === 0;
  },
};
