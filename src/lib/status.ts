import { existsSync, lstatSync, readlinkSync } from "fs";
import { join } from "path";
import { PACKAGES_DIR } from "./config.ts";
import { collectFiles, detectInit, hasInitDirs, type FileEntry } from "./pkg.ts";

export type FileStatus = "ok" | "broken" | "missing" | "drift";

export function checkFileStatus(source: string, target: string): FileStatus {
  if (!existsSync(target)) {
    try {
      const stat = lstatSync(target);
      // Broken symlink: lstat succeeds but path doesn't exist (dangling)
      return stat.isSymbolicLink() ? "broken" : "missing";
    } catch {
      return "missing";
    }
  }
  try {
    const stat = lstatSync(target);
    if (!stat.isSymbolicLink()) return "drift";
    return readlinkSync(target) === source ? "ok" : "broken";
  } catch {
    return "missing";
  }
}

export interface PackageStatus {
  name: string;
  files: FileEntry[];
  counts: Record<FileStatus, number>;
  issues: { target: string; source: string; status: FileStatus }[];
}

export async function collectPackageStatus(pkg: string): Promise<PackageStatus> {
  const pkgDir = join(PACKAGES_DIR, pkg);
  const { runit, systemd } = hasInitDirs(pkgDir);
  const init = runit || systemd ? detectInit() ?? undefined : undefined;
  const homeFiles = await collectFiles(pkgDir, "home");
  const systemFiles = await collectFiles(pkgDir, "system", init);
  const files = [...homeFiles, ...systemFiles];
  const counts: Record<FileStatus, number> = { ok: 0, broken: 0, missing: 0, drift: 0 };
  const issues: PackageStatus["issues"] = [];
  for (const f of files) {
    const s = checkFileStatus(f.source, f.target);
    counts[s]++;
    if (s === "broken" || s === "drift") issues.push({ target: f.target, source: f.source, status: s });
  }
  return { name: pkg, files, counts, issues };
}
