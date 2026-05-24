import { commandExists, getVersion, logInfo, logSection } from "../console.ts";
import type { Updater } from "./types.ts";

export const rustupUpdater: Updater = {
  name: "rustup",
  group: "system",
  async run(check) {
    if (!commandExists("rustup")) return true;
    if (check) { logInfo(`rustup: ${getVersion("rustup", ["--version"])}`); return true; }
    logSection("rustup");
    const r = Bun.spawnSync(["rustup", "update"], { stdout: "inherit", stderr: "inherit" });
    return r.exitCode === 0;
  },
};
