import { readdir, lstat, readlink } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { HOME_DIR, PACKAGES_DIR } from "./config.ts";

export interface GhostItem {
  path: string;
  target?: string;
  type: "file" | "directory";
  children?: GhostItem[];
}

/**
 * Identify broken symlinks and directories that would be empty if those links were removed.
 */
export async function findGhosts(scanRoot: string = HOME_DIR): Promise<GhostItem[]> {
  const allGhosts: GhostItem[] = [];
  const protectedPaths = new Set([HOME_DIR, join(HOME_DIR, ".config")]);

  async function walk(dir: string): Promise<{ isGhostOnly: boolean; ghosts: GhostItem[] }> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return { isGhostOnly: false, ghosts: [] };
    }

    let hasRealContent = false;
    const children: GhostItem[] = [];

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isSymbolicLink()) {
        try {
          const target = await readlink(fullPath);
          if (!existsSync(fullPath) && isDotfilesPath(target)) {
            children.push({ path: fullPath, target, type: "file" });
          } else {
            hasRealContent = true;
          }
        } catch {
          hasRealContent = true;
        }
      } else if (entry.isDirectory()) {
        const { isGhostOnly, ghosts } = await walk(fullPath);
        if (isGhostOnly && !protectedPaths.has(fullPath)) {
          children.push({ path: fullPath, type: "directory", children: ghosts });
        } else {
          hasRealContent = true;
          // Even if the directory itself isn't a ghost, its children might be
          allGhosts.push(...ghosts);
        }
      } else {
        hasRealContent = true;
      }
    }

    if (!hasRealContent && children.length > 0) {
      return { isGhostOnly: true, ghosts: children };
    } else {
      return { isGhostOnly: false, ghosts: children };
    }
  }

  const topEntries = await readdir(scanRoot, { withFileTypes: true });
  for (const entry of topEntries) {
    const fullPath = join(scanRoot, entry.name);
    if (entry.name === ".config") {
      const { ghosts } = await walk(fullPath);
      allGhosts.push(...ghosts);
    } else if (entry.name.startsWith(".")) {
      if (entry.isDirectory()) {
        const { isGhostOnly, ghosts } = await walk(fullPath);
        if (isGhostOnly && !protectedPaths.has(fullPath)) {
          allGhosts.push({ path: fullPath, type: "directory", children: ghosts });
        } else {
          allGhosts.push(...ghosts);
        }
      } else if (entry.isSymbolicLink()) {
        const target = await readlink(fullPath);
        if (!existsSync(fullPath) && isDotfilesPath(target)) {
          allGhosts.push({ path: fullPath, target, type: "file" });
        }
      }
    }
  }

  return allGhosts;
}

export function flattenGhosts(ghosts: GhostItem[]): GhostItem[] {
  const out: GhostItem[] = [];
  for (const g of ghosts) {
    if (g.children) {
      out.push(...flattenGhosts(g.children));
    }
    out.push(g);
  }
  return out;
}

function isDotfilesPath(path: string): boolean {
  // A heuristic to identify if a path belonged to our dotfiles system
  // even if the repo was moved.
  const lower = path.toLowerCase();
  return (
    lower.includes("/packages/") || 
    lower.includes("/dotfiles/") ||
    lower.includes(PACKAGES_DIR.toLowerCase())
  );
}
