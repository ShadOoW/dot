import { readdir, readFile } from "fs/promises";
import { existsSync, lstatSync, readFileSync, readlinkSync } from "fs";
import { hostname } from "os";
import { join } from "path";
import { PACKAGES_DIR, HOME_DIR } from "./config.ts";
import { logWarn } from "./console.ts";

export type FileEntry = { source: string; target: string };

export type PackageManager = "brew" | "xbps" | "cargo" | "pacman";
export type PackageList = Record<PackageManager, string[]>;
export type PackagesMeta = Record<string, PackageList>;

export interface PackageMeta {
  name: string;
  description: string;
  packages: PackagesMeta;
  tags: string[];
  configure: boolean;
  enableScripts: { name: string; init?: string }[];
  cleanSteps: string[];
  os: string[];
  hosts: string[];
  extends: string[];
}

export function detectDistro(): string {
  if (process.platform === "darwin") return "macos";
  try {
    const rel = readFileSync("/etc/os-release", "utf-8");
    if (/^ID=void/m.test(rel)) return "void";
    if (/^ID=arch/m.test(rel)) return "arch";
  } catch { /* fall through to legacy checks */ }
  if (existsSync("/etc/void-release")) return "void";
  if (existsSync("/etc/arch-release")) return "arch";
  return "linux";
}

export function detectInit(): "runit" | "systemd" | "launchd" | null {
  if (existsSync("/run/runit")) return "runit";
  if (existsSync("/run/systemd")) return "systemd";
  if (process.platform === "darwin") return "launchd";
  const proc = Bun.spawnSync(["ps", "-p", "1", "-o", "comm="], { stdout: "pipe" });
  const comm = new TextDecoder().decode(proc.stdout).trim();
  if (comm === "runit") return "runit";
  if (comm === "systemd") return "systemd";
  return null;
}

export async function listPackages(): Promise<string[]> {
  const entries = await readdir(PACKAGES_DIR, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

export async function getPackageMeta(name: string, seen: Set<string> = new Set()): Promise<PackageMeta | null> {
  const pkgDir = join(PACKAGES_DIR, name);
  if (!existsSync(pkgDir)) return null;

  let raw: Record<string, unknown> = {};
  const metaPath = join(pkgDir, "meta.json");
  if (existsSync(metaPath)) {
    try {
      raw = JSON.parse(await readFile(metaPath, "utf-8")) as Record<string, unknown>;
    } catch (e) {
      logWarn(`${name}/meta.json: invalid JSON — ${(e as Error).message}`);
      return null;
    }
  }

  const meta: PackageMeta = {
    name,
    description: (raw.description as string) ?? "",
    packages: (raw.packages as PackagesMeta) ?? {},
    tags: (raw.tags as string[]) ?? [],
    configure: existsSync(join(pkgDir, "configure.sh")),
    enableScripts: collectEnableScripts(pkgDir),
    cleanSteps: (raw.cleanSteps as string[]) ?? [],
    os: (raw.os as string[]) ?? [],
    hosts: (raw.hosts as string[]) ?? [],
    extends: (raw.extends as string[]) ?? [],
  };

  if (meta.extends.length === 0) return meta;

  // Merge parents in declaration order. Cycles and self-references are skipped.
  seen.add(name);
  for (const parentName of meta.extends) {
    if (seen.has(parentName)) continue;
    const parent = await getPackageMeta(parentName, seen);
    if (parent) mergeParentMeta(meta, parent);
  }
  return meta;
}

const unique = (xs: string[]): string[] => [...new Set(xs)];

function mergePackages(base: PackagesMeta, over: PackagesMeta): PackagesMeta {
  const out: PackagesMeta = structuredClone(base);
  for (const [distro, list] of Object.entries(over)) {
    const target = (out[distro] ??= {} as PackageList);
    for (const [pm, names] of Object.entries(list)) {
      const key = pm as PackageManager;
      target[key] = unique([...(target[key] ?? []), ...names]);
    }
  }
  return out;
}

/**
 * Fold a parent's metadata into a child, in place.
 * Additive fields (tags, packages, cleanSteps) union; constraint fields
 * (os, hosts, description) are inherited only when the child leaves them empty,
 * so a child can always override or narrow what a profile declares.
 */
function mergeParentMeta(child: PackageMeta, parent: PackageMeta): void {
  child.tags = unique([...child.tags, ...parent.tags]);
  child.cleanSteps = [...parent.cleanSteps, ...child.cleanSteps];
  child.packages = mergePackages(parent.packages, child.packages);
  if (!child.description) child.description = parent.description;
  if (child.os.length === 0) child.os = [...parent.os];
  if (child.hosts.length === 0) child.hosts = [...parent.hosts];
}

let cachedHost: string | null = null;

export function detectHost(): string {
  if (cachedHost !== null) return cachedHost;
  if (process.env.DOT_HOST) return cachedHost = process.env.DOT_HOST;
  const hostFile = join(HOME_DIR, ".config/dot/host");
  if (existsSync(hostFile)) {
    try {
      const v = readFileSync(hostFile, "utf-8").trim();
      if (v) return cachedHost = v;
    } catch { /* fall through */ }
  }
  return cachedHost = hostname();
}

/**
 * A package "applies" to a host when meta.hosts is empty (universal)
 * or includes the current host. Comparison is case-insensitive.
 */
export function appliesToHost(meta: Pick<PackageMeta, "hosts">, host: string = detectHost()): boolean {
  if (!meta.hosts || meta.hosts.length === 0) return true;
  const h = host.toLowerCase();
  return meta.hosts.some((x) => x.toLowerCase() === h);
}

export async function collectFiles(pkgDir: string, section: "home" | "system", init?: string): Promise<FileEntry[]> {
  const files: FileEntry[] = [];
  const sectionDir = join(pkgDir, section);
  if (!existsSync(sectionDir)) return files;

  const skipNames = new Set(["README.md", "configure.sh", "CHEATSHEET.md", "setup.sh", "meta.json"]);

  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (skipNames.has(entry.name) || entry.name.startsWith("enable") || entry.name.startsWith("disable")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        const rel = full.replace(pkgDir + "/", "");
        if (rel === "system/runit" && init !== "runit") continue;
        if (rel === "system/systemd" && init !== "systemd") continue;
        if (rel === "system/launchd" && init !== "launchd") continue;
        await walk(full);
      } else {
        const relative = full.replace(pkgDir + "/", "");
        files.push({ source: full, target: resolveTarget(relative) });
      }
    }
  }

  await walk(sectionDir);
  return files;
}

export function resolveTarget(relative: string): string {
  if (relative.startsWith("home/")) return join(HOME_DIR, relative.slice(5));
  if (relative.startsWith("system/base/")) return "/" + relative.slice(12);
  if (relative.startsWith("system/runit/")) return "/" + relative.slice(13);
  if (relative.startsWith("system/systemd/")) return "/" + relative.slice(15);
  if (relative.startsWith("system/launchd/")) return join(HOME_DIR, relative.slice(15));
  if (relative.startsWith("system/")) return "/" + relative.slice(7);
  return "/" + relative;
}

export function hasInitDirs(pkgDir: string): { runit: boolean; systemd: boolean; launchd: boolean } {
  return {
    runit: existsSync(join(pkgDir, "system", "runit")),
    systemd: existsSync(join(pkgDir, "system", "systemd")),
    launchd: existsSync(join(pkgDir, "system", "launchd")),
  };
}

export function isAlreadyLinked(source: string, target: string): boolean {
  try {
    if (!existsSync(target)) return false;
    const stat = lstatSync(target);
    return stat.isSymbolicLink() && readlinkSync(target) === source;
  } catch {
    return false;
  }
}

function collectEnableScripts(pkgDir: string): { name: string; init?: string }[] {
  return ["enable-runit.sh", "enable-systemd.sh", "enable-launchd.sh", "enable.sh"]
    .filter((f) => existsSync(join(pkgDir, f)))
    .map((f) => ({
      name: f.replace(".sh", ""),
      init: f.includes("runit") ? "runit" : f.includes("systemd") ? "systemd" : f.includes("launchd") ? "launchd" : undefined,
    }));
}
