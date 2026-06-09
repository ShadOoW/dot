import { existsSync } from "fs";
import { join } from "path";
import { HOME_DIR } from "../config.ts";
import { commandExists, getVersion, logError, logInfo, logSuccess } from "../console.ts";
import { spawnInherit } from "../spawn.ts";
import type { Updater } from "./types.ts";

export const iwmenuUpdater: Updater = {
  name: "iwmenu",
  group: "source",
  async run(check) {
    const dir = join(HOME_DIR, ".builds/iwmenu");
    const repo = "https://github.com/e-tho/iwmenu.git";

    if (!commandExists("git") || !commandExists("cargo")) return true;

    if (check) {
      if (existsSync(dir)) {
        const r = Bun.spawnSync(["git", "-C", dir, "rev-parse", "--short", "HEAD"], { stdout: "pipe" });
        logInfo(`iwmenu: ${new TextDecoder().decode(r.stdout).trim()}`);
      } else {
        logInfo("iwmenu: not cloned");
      }
      return true;
    }

    let headChanged = true;

    if (!existsSync(dir)) {
      logInfo("iwmenu: cloning…");
      const r = await spawnInherit(["git", "clone", "--depth=1", repo, dir]);
      if (r.exitCode !== 0) { logError("iwmenu: clone failed"); return false; }
    } else {
      const headBefore = new TextDecoder().decode(
        Bun.spawnSync(["git", "-C", dir, "rev-parse", "HEAD"], { stdout: "pipe" }).stdout,
      ).trim();

      logInfo("iwmenu: pulling…");
      const pullR = Bun.spawnSync(
        ["git", "-C", dir, "pull", "-q", "--ff-only"],
        { stdout: "pipe", stderr: "pipe" },
      );
      if (pullR.exitCode !== 0) {
        const err = new TextDecoder().decode(pullR.stderr).trim().split("\n").slice(0, 5).join("\n");
        logError(`iwmenu: git pull failed\n${err}`);
        return false;
      }

      const headAfter = new TextDecoder().decode(
        Bun.spawnSync(["git", "-C", dir, "rev-parse", "HEAD"], { stdout: "pipe" }).stdout,
      ).trim();
      headChanged = headBefore !== headAfter;
    }

    const installed = commandExists("iwmenu") || existsSync("/usr/local/bin/iwmenu");
    if (!headChanged && installed) {
      const tag = new TextDecoder().decode(
        Bun.spawnSync(["git", "-C", dir, "describe", "--tags", "--abbrev=0"], { stdout: "pipe", stderr: "pipe" }).stdout,
      ).trim();
      logSuccess(`iwmenu: up to date${tag ? ` (${tag})` : ""}`);
      return true;
    }

    logInfo("iwmenu: building…");
    const build = Bun.spawnSync(["cargo", "build", "--release"], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    if (build.exitCode !== 0) {
      process.stderr.write(build.stderr);
      logError("iwmenu: build failed");
      return false;
    }

    const priv = commandExists("doas") ? "doas" : "sudo";
    const install = await spawnInherit([priv, "cp", join(dir, "target/release/iwmenu"), "/usr/local/bin/iwmenu"]);
    if (install.exitCode !== 0) { logError("iwmenu: install failed"); return false; }

    const ver = getVersion("iwmenu", ["--version"]);
    logSuccess(`iwmenu: ${ver || "installed"}`);
    return true;
  },
};
