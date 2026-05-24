import { existsSync } from "fs";
import { mkdir } from "fs/promises";
import { join } from "path";
import { CACHE_DIR, HOME_DIR } from "../config.ts";
import { commandExists, logError, logInfo, logSuccess, logWarn } from "../console.ts";
import { findAsset, getLatestRelease } from "../github.ts";
import type { Updater } from "./types.ts";

export const anyzigUpdater: Updater = {
  name: "anyzig",
  group: "source",
  async run(check) {
    const zigPath = join(HOME_DIR, ".local/bin/zig");
    if (!existsSync(zigPath) && !commandExists("zig")) return true;

    const release = await getLatestRelease("marler8997/anyzig");
    if (!release) {
      logWarn("anyzig: could not fetch latest release");
      return false;
    }
    const latestVer = release.tag_name;

    const verFile = join(CACHE_DIR, "anyzig.version");
    const installedVer = existsSync(verFile) ? (await Bun.file(verFile).text()).trim() : null;

    if (check) {
      logInfo(`anyzig: ${installedVer ?? "not tracked"} → ${latestVer}`);
      return true;
    }

    if (installedVer === latestVer && existsSync(zigPath)) {
      logSuccess(`anyzig: up to date (${latestVer})`);
      return true;
    }

    const asset = findAsset(release, /anyzig-x86_64-linux\.tar\.gz$/i);
    if (!asset) {
      logError("anyzig: no matching asset in release");
      return false;
    }

    logInfo(`anyzig: downloading ${latestVer}…`);
    const tmpR = Bun.spawnSync(["mktemp", "/tmp/anyzig.tar.gz.XXXXXX"], { stdout: "pipe" });
    const tmpfile = new TextDecoder().decode(tmpR.stdout).trim();
    const dlR = Bun.spawnSync(["curl", "-fsSL", asset.browser_download_url, "-o", tmpfile], { stdout: "pipe", stderr: "pipe" });
    if (dlR.exitCode !== 0) {
      logError("anyzig: download failed");
      Bun.spawnSync(["rm", "-f", tmpfile]);
      return false;
    }
    Bun.spawnSync(["tar", "-xzf", tmpfile, "-C", join(HOME_DIR, ".local/bin")], { stdout: "pipe" });
    Bun.spawnSync(["chmod", "+x", zigPath]);
    Bun.spawnSync(["rm", "-f", tmpfile]);
    await mkdir(CACHE_DIR, { recursive: true });
    await Bun.write(verFile, latestVer);
    logSuccess(`anyzig: ${installedVer ? `${installedVer} → ${latestVer}` : `installed (${latestVer})`}`);
    return true;
  },
};
