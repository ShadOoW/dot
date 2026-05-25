import { existsSync } from "fs";
import { join } from "path";
import { HOME_DIR } from "../config.ts";
import { commandExists, getVersion, logError, logInfo, logSuccess } from "../console.ts";
import { spawnInherit } from "../spawn.ts";
import type { Updater } from "./types.ts";

export const lyUpdater: Updater = {
  name: "ly",
  group: "source",
  async run(check) {
    const lyDir = join(HOME_DIR, ".builds/ly");
    const lyRepo = "https://codeberg.org/fairyglade/ly.git";
    const zigCmd = existsSync(join(HOME_DIR, ".local/bin/zig")) ? join(HOME_DIR, ".local/bin/zig") : "zig";

    if (!commandExists("git")) return true;
    if (check) {
      if (existsSync(lyDir)) {
        const r = Bun.spawnSync(["git", "-C", lyDir, "rev-parse", "--short", "HEAD"], { stdout: "pipe" });
        logInfo(`ly: ${new TextDecoder().decode(r.stdout).trim()}`);
      } else {
        logInfo("ly: not cloned");
      }
      return true;
    }

    let headChanged = true;

    if (!existsSync(lyDir)) {
      logInfo("ly: cloning…");
      const r = await spawnInherit(["git", "clone", "--recurse-submodules", lyRepo, lyDir]);
      if (r.exitCode !== 0) { logError("ly: clone failed"); return false; }
    } else {
      const headBefore = new TextDecoder().decode(
        Bun.spawnSync(["git", "-C", lyDir, "rev-parse", "HEAD"], { stdout: "pipe" }).stdout,
      ).trim();

      logInfo("ly: fetching…");
      const subR = Bun.spawnSync(
        ["git", "-C", lyDir, "submodule", "update", "--init", "--recursive", "-q"],
        { stdout: "pipe", stderr: "pipe" },
      );
      if (subR.exitCode !== 0) {
        const err = new TextDecoder().decode(subR.stderr).trim().split("\n").slice(0, 5).join("\n");
        logError(`ly: submodule update failed\n${err}`);
        return false;
      }

      const pullR = Bun.spawnSync(
        ["git", "-C", lyDir, "pull", "-q", "--ff-only"],
        { stdout: "pipe", stderr: "pipe" },
      );
      if (pullR.exitCode !== 0) {
        const err = new TextDecoder().decode(pullR.stderr).trim().split("\n").slice(0, 5).join("\n");
        logError(`ly: git pull failed\n${err}`);
        return false;
      }

      const headAfter = new TextDecoder().decode(
        Bun.spawnSync(["git", "-C", lyDir, "rev-parse", "HEAD"], { stdout: "pipe" }).stdout,
      ).trim();
      headChanged = headBefore !== headAfter;
    }

    const lyInstalled = commandExists("ly") || existsSync("/usr/bin/ly");
    if (!headChanged && lyInstalled) {
      const lyTag = new TextDecoder().decode(
        Bun.spawnSync(["git", "-C", lyDir, "describe", "--tags", "--abbrev=0"], { stdout: "pipe", stderr: "pipe" }).stdout,
      ).trim();
      logSuccess(`ly: up to date${lyTag ? ` (${lyTag})` : ""}`);
      return true;
    }

    logInfo("ly: building…");
    const build = Bun.spawnSync([zigCmd, "build"], { cwd: lyDir, stdout: "pipe", stderr: "pipe" });
    if (build.exitCode !== 0) {
      process.stderr.write(build.stderr);
      logError("ly: build failed");
      return false;
    }
    const priv = commandExists("doas") ? "doas" : "sudo";
    const install = await spawnInherit([priv, zigCmd, "build", "installnoconf"], { cwd: lyDir });
    if (install.exitCode !== 0) { logError("ly: install failed"); return false; }
    const lyVer = getVersion("ly", ["-v"]);
    logSuccess(`ly: ${lyVer || "installed"}`);
    return true;
  },
};
