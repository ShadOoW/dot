import { commandExists, getVersion, logInfo, logSection } from "../console.ts";
import { spawnInherit } from "../spawn.ts";
import type { Updater } from "./types.ts";

export const pacmanUpdater: Updater = {
  name: "pacman",
  group: "system",
  async run(check) {
    if (!commandExists("pacman")) return true;
    if (check) { logInfo(`pacman: ${getVersion("pacman", ["--version"])}`); return true; }
    const priv = commandExists("doas") ? "doas" : "sudo";
    logSection("pacman");
    const r = await spawnInherit([priv, "pacman", "-Syu", "--noconfirm"], { pty: false });
    return r.exitCode === 0;
  },
};
