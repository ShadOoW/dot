import { existsSync } from "fs";
import { join } from "path";
import { HOME_DIR } from "../config.ts";
import { commandExists, logInfo } from "../console.ts";
import { spawnInherit } from "../spawn.ts";
import type { Updater } from "./types.ts";

export const zinitUpdater: Updater = {
  name: "zinit",
  group: "source",
  async run(check) {
    const zinitDir = join(HOME_DIR, ".local/share/zinit");
    if (!existsSync(zinitDir) || !commandExists("zsh")) return true;
    const src = `source ${zinitDir}/zinit.git/zinit.zsh`;
    if (check) { logInfo(`zinit: ${zinitDir}`); return true; }
    const r1 = await spawnInherit(["zsh", "-c", `${src} && zinit self-update`]);
    const r2 = await spawnInherit(["zsh", "-c", `${src} && zinit update --all`]);
    return r1.exitCode === 0 && r2.exitCode === 0;
  },
};
