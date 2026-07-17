import { dirname, join } from "path";

// This file lives at <root>/src/lib/config.ts — root is two levels up
export const DOTFILES_DIR = join(dirname(import.meta.path), "../..");
export const PACKAGES_DIR = join(DOTFILES_DIR, "packages");
export const PKGBUILDS_DIR = join(DOTFILES_DIR, "pkgbuilds");
export const DOCS_DIR = join(DOTFILES_DIR, "docs");
export const HOME_DIR = process.env.HOME ?? "/root";
export const CACHE_DIR = join(HOME_DIR, ".cache/dot");
export const STATE_DIR = process.env.XDG_STATE_HOME
  ? join(process.env.XDG_STATE_HOME, "dot")
  : join(HOME_DIR, ".local/state/dot");
