import { existsSync } from "fs";
import { readdir } from "fs/promises";
import { join } from "path";
import { CACHE_DIR, PKGBUILDS_DIR } from "../config.ts";
import { commandExists, logError, logInfo, logWarn } from "../console.ts";
import type { Updater } from "./types.ts";

function getInstalledXbpsVersion(pkg: string): string | null {
  const r = Bun.spawnSync(["xbps-query", "-p", "pkgver", pkg], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) return null;
  const pkgver = new TextDecoder().decode(r.stdout).trim();
  const match = pkgver.match(/^.+-(\d[\d.]+)_\d+$/);
  return match?.[1] ?? null;
}

function getTemplateVersion(buildScript: string): string | null {
  const r = Bun.spawnSync(["grep", "-m1", "^VERSION=", buildScript], { stdout: "pipe" });
  const line = new TextDecoder().decode(r.stdout).trim();
  return line ? line.replace(/^VERSION=["']?/, "").replace(/["']?$/, "") : null;
}

export const pkgbuildsUpdater: Updater = {
  name: "pkgbuilds",
  group: "source",
  async run(check) {
    if (!commandExists("xbps-create")) { logWarn("xbps-create: not found, skipping"); return true; }
    if (!existsSync(PKGBUILDS_DIR)) return true;

    const entries = await readdir(PKGBUILDS_DIR, { withFileTypes: true });
    let ok = true;
    for (const entry of entries.filter((e) => e.isDirectory())) {
      const name = entry.name;
      const buildScript = join(PKGBUILDS_DIR, name, "build.sh");
      if (!existsSync(buildScript)) continue;

      const installed = getInstalledXbpsVersion(name);
      const template = getTemplateVersion(buildScript);

      if (check) {
        logInfo(`${name}: installed=${installed ?? "not installed"} template=${template ?? "unknown"}`);
        continue;
      }

      if (installed && template && installed === template) {
        logInfo(`${name}: up to date (${installed})`);
        continue;
      }

      logInfo(`${name}: building ${template}…`);
      const cacheDir = join(CACHE_DIR, name);
      const result = Bun.spawnSync(["bash", buildScript, cacheDir], { stdout: "inherit", stderr: "inherit" });
      if (result.exitCode !== 0) { logError(`${name}: build failed`); ok = false; }
    }
    return ok;
  },
};
