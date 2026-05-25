import { anyzigUpdater } from "./anyzig.ts";
import { bunGlobalUpdater } from "./bun-global.ts";
import { bunSelfUpdater } from "./bun-self.ts";
import { cargoUpdater } from "./cargo.ts";
import { completionsUpdater } from "./completions.ts";
import { denoUpdater } from "./deno.ts";
import { flatpakUpdater } from "./flatpak.ts";
import { fnmUpdater } from "./fnm.ts";
import { lyUpdater } from "./ly.ts";
import { npmUpdater } from "./npm.ts";
import { pacmanUpdater } from "./pacman.ts";
import { pipxUpdater } from "./pipx.ts";
import { pkgbuildsUpdater } from "./pkgbuilds.ts";
import { pnpmUpdater } from "./pnpm.ts";
import { rustupUpdater } from "./rustup.ts";
import { xbpsUpdater } from "./xbps.ts";
import { yarnUpdater } from "./yarn.ts";
import { yayUpdater } from "./yay.ts";
import { zinitUpdater } from "./zinit.ts";
import type { Updater, UpdaterGroup } from "./types.ts";

export type { Updater, UpdaterGroup };

export const UPDATERS: Updater[] = [
  // system
  xbpsUpdater,
  pacmanUpdater,
  yayUpdater,
  flatpakUpdater,
  bunSelfUpdater,
  denoUpdater,
  rustupUpdater,
  // global
  npmUpdater,
  bunGlobalUpdater,
  yarnUpdater,
  pnpmUpdater,
  pipxUpdater,
  cargoUpdater,
  completionsUpdater,
  // source
  pkgbuildsUpdater,
  fnmUpdater,
  anyzigUpdater,
  lyUpdater,
  zinitUpdater,
];

export async function runGroup(group: UpdaterGroup, check: boolean): Promise<boolean> {
  let ok = true;
  for (const u of UPDATERS.filter((u) => u.group === group)) {
    if (!await u.run(check)) ok = false;
  }
  return ok;
}
