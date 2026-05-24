import { commandExists, logInfo, logSection, logWarn } from "../console.ts";
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
    if (check) { Bun.spawnSync(["cargo", "install-update", "--dry-run"], { stdout: "inherit" }); return true; }
    logSection("cargo");
    const r = Bun.spawnSync(["cargo", "install-update", "-a"], { stdout: "inherit", stderr: "inherit" });
    return r.exitCode === 0;
  },
};
