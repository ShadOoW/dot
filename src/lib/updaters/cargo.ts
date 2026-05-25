import { commandExists, logInfo, logSection, logWarn } from "../console.ts";
import { spawnInherit } from "../spawn.ts";
import type { Updater } from "./types.ts";

export const cargoUpdater: Updater = {
  name: "cargo",
  group: "global",
  async run(check) {
    if (!commandExists("cargo")) return true;
    if (!commandExists("cargo-install-update")) {
      logWarn("cargo-install-update not found — install with: cargo install cargo-install-update");
      return true;
    }
    if (check) { await spawnInherit(["cargo", "install-update", "--dry-run"]); return true; }
    logSection("cargo");
    const r = await spawnInherit(["cargo", "install-update", "-a"]);
    return r.exitCode === 0;
  },
};
