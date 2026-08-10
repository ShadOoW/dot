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
export type StepCallback = (name: string, run: () => Promise<boolean>) => Promise<boolean>;

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

export async function runGroup(group: UpdaterGroup, check: boolean, step?: StepCallback): Promise<boolean> {
  let ok = true;
  for (const u of UPDATERS.filter((u) => u.group === group)) {
    const result = step ? await step(u.name, () => u.run(check)) : await u.run(check);
    if (!result) ok = false;
  }
  return ok;
}
