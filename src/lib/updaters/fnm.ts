import { commandExists, getVersion, logError, logInfo, logSuccess, logWarn } from "../console.ts";
import type { Updater } from "./types.ts";

export const fnmUpdater: Updater = {
  name: "fnm",
  group: "source",
  async run(check) {
    if (!commandExists("cargo")) { logWarn("fnm: cargo not found, skipping"); return true; }
    if (check) { logInfo(`fnm: ${getVersion("fnm", ["--version"])}`); return true; }
    const vBefore = getVersion("fnm", ["--version"]);
    logInfo("fnm: updating via cargo…");
    const r = Bun.spawnSync(["cargo", "install", "fnm"], { stdout: "pipe", stderr: "pipe" });
    if (r.exitCode !== 0) {
      process.stderr.write(r.stderr);
      logError("fnm: install failed");
      return false;
    }
    const vAfter = getVersion("fnm", ["--version"]);
    if (vBefore !== vAfter) {
      logSuccess(`fnm: ${vBefore} → ${vAfter}`);
    } else {
      logSuccess(`fnm: up to date (${vAfter})`);
    }
    return true;
  },
};
