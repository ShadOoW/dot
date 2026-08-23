import { existsSync } from "fs";
import { join } from "path";
import { HOME_DIR } from "../config.ts";
import { commandExists, logInfo } from "../console.ts";
import { spawnInherit } from "../spawn.ts";
import type { Updater } from "./types.ts";

/**
 * Mirrors packages/zsh/home/.zprofile.d/10-managed-cache.zsh: when the managed-cache
 * marker exists, the live zinit tree is under ~/.cache, and ~/.local/share/zinit is a
 * stale leftover. Updating the wrong one is silent — zinit derives ZINIT[BIN_DIR] from
 * wherever zinit.zsh was sourced, so it happily self-updates a checkout no shell loads.
 * That is what happened here: the cache tree had 9 plugins, the .local/share one had 1.
 */
function zinitHome(): string {
  return existsSync(join(HOME_DIR, ".cache/.managed"))
    ? join(HOME_DIR, ".cache/managed-zinit/polaris")
    : join(HOME_DIR, ".local/share/zinit");
}

export const zinitUpdater: Updater = {
  name: "zinit",
  group: "source",
  async run(check) {
    const homeDir = zinitHome();
    const managed = homeDir.includes("/.cache/");
    const binDir = join(homeDir, managed ? "bin/zinit.git" : "zinit.git");
    if (!existsSync(join(binDir, "zinit.zsh")) || !commandExists("zsh")) return true;
    if (check) { logInfo(`zinit: ${binDir}`); return true; }

    // `zsh -c` reads .zshenv but not .zshrc.d/00-zinit.zsh, so the ZINIT[] paths that
    // interactive shells use have to be restated here — otherwise `update --all` walks
    // the default ~/.local/share/zinit/plugins instead of the tree actually in use.
    //
    // NO_PAGER is load-bearing, not cosmetic: .zinit-pager pipes the self-update commit
    // log into `less -FRXi`, and with stdio inherited that sits at the `:` prompt forever
    // (-X also disables the alternate screen, so the redraws spill into the scrollback).
    // `zinit self-update` does not accept --no-pager — its opt spec is only
    // --help|--quiet — so the ZINIT[NO_PAGER] setting is the sole way to disarm it.
    const prelude = [
      "typeset -gA ZINIT",
      `ZINIT[HOME_DIR]=${homeDir}`,
      `ZINIT[BIN_DIR]=${binDir}`,
      `ZINIT[PLUGINS_DIR]=${join(homeDir, "plugins")}`,
      `ZINIT[SNIPPETS_DIR]=${join(homeDir, "snippets")}`,
      `ZINIT[COMPLETIONS_DIR]=${join(homeDir, "completions")}`,
      `source ${binDir}/zinit.zsh`,
      "ZINIT[NO_PAGER]=1",
    ].join("\n");

    const r1 = await spawnInherit(["zsh", "-c", `${prelude}\nzinit self-update`]);
    const r2 = await spawnInherit(["zsh", "-c", `${prelude}\nzinit update --all`]);
    return r1.exitCode === 0 && r2.exitCode === 0;
  },
};
