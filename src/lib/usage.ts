// Software-usage tracking: which installed software is actually used, so the rest
// can be removed with evidence instead of vibes.
//
// ── Why four sources and not one ─────────────────────────────────────────────────
// There is no single signal on Linux that answers "was this binary used". Each one
// available here is wrong in a different, *known* direction, so we record them
// separately (one `usage` row per (bin, source)) and let the reports decide how much
// to trust each. Collapsing them into one column would throw away exactly the
// information needed to know whether an answer is safe to act on.
//
//   acct    BSD process accounting (CONFIG_BSD_PROCESS_ACCT_V3=y on this kernel).
//           The kernel appends a 64-byte record for *every* process that exits.
//           Complete — catches `ls` — but records only comm[16], so `node`,
//           `python3` and long names are ambiguous and there is no path. Needs root
//           to turn on, so it is opt-in, not assumed.
//   proc    Polling /proc. Resolves /proc/PID/exe to a real path, which is the only
//           source that gives unambiguous attribution, but a poll at interval N
//           cannot see a process that lived < N. Complements acct exactly: acct has
//           the counts, proc has the identities. Unprivileged it sees only your own
//           processes (measured: 181 of 625 PIDs readable as uid 1000), so the
//           daemon is meant to run as root.
//   atime   Filesystem access time of every package-owned executable. Retroactive —
//           it answers "when was this last run" for software installed long before
//           tracking started, which no live source can. `/` is mounted relatime, so
//           granularity is ~1 day, and any full-tree read (a backup, `xbps-pkgdb -a`,
//           a `grep -r /usr`) rewrites every atime and blinds the signal, which
//           `scanAtimes` detects and reports rather than silently trusting.
//   history Shell history via atuin's sqlite db. Six months of exact timestamps for
//           interactive commands already existed on this host before any of this
//           code ran, so it is the only way to have useful data on day one. Covers
//           only what was typed at a prompt: nothing about services or libraries.
//
// ── The safe direction ──────────────────────────────────────────────────────────
// Aggregation takes max(last_seen) across sources, so every failure mode listed
// above (a polluted atime, a comm collision, a double-counted poll) can only make
// software look *more* used than it is. That biases the tool toward under-removal,
// which costs disk; the opposite bias costs a broken system.

import { dlopen, FFIType } from "bun:ffi";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, statSync, truncateSync, writeFileSync } from "fs";
import { basename, dirname, join } from "path";
import { HOME_DIR } from "./config.ts";

// ── where state lives ───────────────────────────────────────────────────────────
// System-wide, not under $HOME: the collector runs as root under runit (that is the
// only way to see other users' and services' processes) while reports run as you.
// A db under /root would be invisible to the reports; one under ~shad would be
// written as root and then unwritable by you.
export const USAGE_DIR = "/var/lib/dot";
export const USAGE_DB = join(USAGE_DIR, "usage.db");
/** Where the kernel appends process-accounting records once `acct` is on. */
export const PACCT_FILE = join(USAGE_DIR, "pacct");
/** Fallback for unprivileged use, so `dot usage` is never simply unusable. */
export const USER_USAGE_DB = join(HOME_DIR, ".local/state/dot/usage.db");

export type Source = "acct" | "proc" | "atime" | "history";
export const SOURCES: Source[] = ["acct", "proc", "atime", "history"];

/** Sources that cannot be forged by a filesystem scan — what `unused` trusts. */
export const HARD_SOURCES: Source[] = ["acct", "proc", "history"];

export interface Observation {
  /** Absolute path when known, else `comm:<name>` for a name-only sighting. */
  key: string;
  source: Source;
  /** Unix seconds. */
  when: number;
  count: number;
  /** Wall seconds observed running; 0 for sources that cannot know. */
  seconds?: number;
}

// ────────────────────────────────────────────────────────────────────────────────
// plist
// ────────────────────────────────────────────────────────────────────────────────

/**
 * Minimal Apple-XML-plist reader for the subset xbps writes (dict/array/string/
 * integer/real/true/false/data). xbps keeps its whole database in this format, and
 * shelling out to `xbps-query -p` once per package costs ~9s for 827 packages —
 * measured — which is too slow to sit behind an interactive report. Parsing the one
 * file directly is ~100ms and gives the full dependency graph in one pass.
 */
export function parsePlist(xml: string): unknown {
  let i = xml.indexOf("<plist");
  if (i < 0) throw new Error("not a plist");
  i = xml.indexOf(">", i) + 1;

  const skipWs = () => {
    while (i < xml.length && /\s/.test(xml[i]!)) i++;
  };

  /** Reads the next `<tag`, returning its name and whether it self-closed. */
  const openTag = (): { name: string; selfClosed: boolean } | null => {
    skipWs();
    if (xml[i] !== "<") return null;
    if (xml.startsWith("</", i)) return null;
    const end = xml.indexOf(">", i);
    if (end < 0) throw new Error("unterminated tag");
    const raw = xml.slice(i + 1, end);
    i = end + 1;
    const selfClosed = raw.endsWith("/");
    const name = (selfClosed ? raw.slice(0, -1) : raw).trim().split(/\s/)[0]!;
    return { name, selfClosed };
  };

  const closeTag = (name: string) => {
    skipWs();
    const want = `</${name}>`;
    if (!xml.startsWith(want, i)) throw new Error(`expected ${want} at ${i}`);
    i += want.length;
  };

  const text = (name: string): string => {
    const end = xml.indexOf(`</${name}>`, i);
    if (end < 0) throw new Error(`unterminated <${name}>`);
    const raw = xml.slice(i, end);
    i = end + `</${name}>`.length;
    return decodeEntities(raw);
  };

  const value = (): unknown => {
    const tag = openTag();
    if (!tag) throw new Error(`expected a value at ${i}`);
    const { name, selfClosed } = tag;
    if (name === "true") {
      if (!selfClosed) closeTag("true");
      return true;
    }
    if (name === "false") {
      if (!selfClosed) closeTag("false");
      return false;
    }
    if (selfClosed) return name === "array" ? [] : name === "dict" ? {} : "";
    switch (name) {
      case "string":
        return text("string");
      case "integer":
        return Number.parseInt(text("integer"), 10);
      case "real":
        return Number.parseFloat(text("real"));
      case "data":
        return text("data").replace(/\s+/g, "");
      case "date":
        return text("date");
      case "array": {
        const out: unknown[] = [];
        for (;;) {
          skipWs();
          if (xml.startsWith("</array>", i)) break;
          out.push(value());
        }
        closeTag("array");
        return out;
      }
      case "dict": {
        const out: Record<string, unknown> = {};
        for (;;) {
          skipWs();
          if (xml.startsWith("</dict>", i)) break;
          const k = openTag();
          if (!k || k.name !== "key") throw new Error(`expected <key> at ${i}`);
          const key = text("key");
          out[key] = value();
        }
        closeTag("dict");
        return out;
      }
      default:
        throw new Error(`unsupported plist tag <${name}>`);
    }
  };

  return value();
}

function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

// ────────────────────────────────────────────────────────────────────────────────
// package index
// ────────────────────────────────────────────────────────────────────────────────

export const XBPS_DB = "/var/db/xbps";
export const PACMAN_DB = "/var/lib/pacman/local";

/** The distro's own package manager — the one `unused` is allowed to judge. */
export type NativeManager = "xbps" | "pacman";

export interface PkgRecord {
  name: string;
  version: string;
  /** Pulled in as a dependency rather than asked for (xbps `automatic-install`, pacman `%REASON% 1`). */
  automatic: boolean;
  installDate: string;
  /** Bytes, as recorded by the package manager. */
  size: number;
  desc: string;
  /** Dependencies, resolved to installed package names. */
  deps: string[];
  /** Inverse of `deps`. */
  revdeps: string[];
  /** Executable paths this package owns (bin/sbin/libexec dirs). */
  bins: string[];
  /** Non-exec ways this package can be in use — see `PassiveKind`. */
  passive: PassiveKind[];
}

export interface PkgIndex {
  /** Which package manager this index came from; `ownerOf` tags paths with it. */
  manager: NativeManager;
  pkgs: Map<string, PkgRecord>;
  /** Executable path -> owning package name. */
  byPath: Map<string, string>;
  /** Executable basename -> owning package names (ambiguous by construction). */
  byName: Map<string, string[]>;
  /** Dependency closure of the distro's base metapackage, kernels and libc. */
  protected: Set<string>;
}

/**
 * Strips an xbps dependency pattern down to a package name.
 *
 * Patterns come in two shapes: an operator form (`glibc>=2.41_1`,
 * `wlroots0.19>=0.19.3_1`) and an exact form (`foo-1.2.3_4`). Cutting at the first
 * comparison character handles the first and preserves version-suffixed *names*
 * like `wlroots0.19`, which a naive digit strip would mangle. The exact form is
 * only recognised when the tail actually looks like `-<version>_<revision>`, so a
 * hyphenated name such as `base-files` survives.
 */
export function depToName(dep: string): string {
  const cut = dep.search(/[<>=]/);
  if (cut > 0) return dep.slice(0, cut);
  const m = /^(.*)-[^-]*_\d+$/.exec(dep);
  return m ? m[1]! : dep;
}

/**
 * Directories whose contents are meant to be executed. Void symlinks /bin, /sbin
 * and /usr/sbin onto /usr/bin, but package file lists record whichever path the
 * package used, so all spellings have to match.
 *
 * `/opt/<app>/` is included wholesale rather than only its `bin/` subdirectory.
 * Bundled applications put their entry point wherever they like — Vivaldi's is
 * `/opt/vivaldi/vivaldi-bin` — and requiring a `bin/` component made a browser that
 * was running at that very moment come back as unused, because the running path
 * matched no package and its usage was filed under a synthetic `opt` owner instead.
 */
const EXEC_DIR = /^\/(usr\/(bin|sbin|libexec|lib\/[^/]+\/(bin|libexec))\/|opt\/[^/]+\/|bin\/|sbin\/)/;

/**
 * How a package can be in use without any of its files ever being `exec`d.
 *
 * This is the single biggest source of wrong answers in a usage tracker, and it is
 * not a rare corner. Measured on this host, a purely exec-based verdict nominated
 * `intel-ucode` (an i5-13500's microcode), `glibc-32bit` (69 dependants),
 * `mesa-vulkan-intel` and `linux-firmware-nvidia` for removal — every one of them
 * load-bearing, none of them ever executed. The consumer is the kernel, the
 * initramfs, the Vulkan loader or the 32-bit ELF interpreter, and none of those
 * leaves an exec trace or an xbps dependency edge.
 *
 * Classification is by the *shape* of the paths a package owns, never by name, so it
 * keeps working as the package set changes.
 */
export type PassiveKind = "firmware" | "initramfs" | "driver" | "multilib" | "plugin" | "service";

const PASSIVE_DIRS: { kind: PassiveKind; test: RegExp }[] = [
  // Loaded by the kernel by path, never exec'd.
  { kind: "firmware", test: /^\/usr\/lib\/(firmware|modules)\// },
  // Copied into the initramfs, which runs before any filesystem this tool can watch.
  { kind: "initramfs", test: /^\/(usr\/lib\/dracut|etc\/dracut\.conf\.d|etc\/mkinitcpio)/ },
  // dlopen'd by a loader that discovers them through a registry directory.
  { kind: "driver", test: /^\/usr\/(share\/(vulkan|glvnd)|lib\/(dri|vdpau|gbm)\/|lib\/libvulkan_)/ },
  // Only ever mapped by a 32-bit process — Steam, wine — through the ELF interpreter.
  { kind: "multilib", test: /^\/usr\/lib32\// },
  // Plugin trees scanned at runtime by their host: PAM, GTK, Qt, pipewire, NSS.
  {
    kind: "plugin",
    test: /^\/usr\/lib\/(security|pkcs11|nss|gio\/modules|gtk-[\d.]+|qt\d?[\d.]*\/plugins|gdk-pixbuf[^/]*|pipewire-[\d.]+|spa-[\d.]+|alsa-lib|girepository-[\d.]+)\//,
  },
  // A service definition is used by being enabled, which is not an exec of this pkg.
  { kind: "service", test: /^\/(etc\/sv|etc\/runit|etc\/systemd\/system|usr\/lib\/systemd\/(system|user))\// },
];

export interface PkgFiles {
  bins: string[];
  /** Non-exec ways this package can be in use; empty means exec is the whole story. */
  passive: PassiveKind[];
}

/**
 * What a package owns that bears on whether it is used, from
 * `/var/db/xbps/.<pkg>-files.plist`.
 *
 * These 820 files total 24 MB; fully parsing them all to pull out a few thousand
 * paths is wasted work, so this scans for absolute paths in the directories that
 * matter. Both `files` and link `target` entries are matched — a symlink in /usr/bin
 * is as runnable as a real file, and its target is a real executable path too.
 */
export function scanPkgFiles(pkg: string, dbDir = XBPS_DB): PkgFiles {
  const f = join(dbDir, `.${pkg}-files.plist`);
  if (!existsSync(f)) return { bins: [], passive: [] };
  const bins = new Set<string>();
  const passive = new Set<PassiveKind>();
  const xml = readFileSync(f, "utf8");
  for (const m of xml.matchAll(/<string>(\/[^<]*)<\/string>/g)) {
    const p = m[1]!;
    if (EXEC_DIR.test(p)) {
      bins.add(decodeEntities(p));
      continue;
    }
    for (const d of PASSIVE_DIRS) if (d.test.test(p)) passive.add(d.kind);
  }
  return { bins: [...bins], passive: [...passive] };
}

/**
 * Raw per-package facts, before the graph is built. Each package manager's database
 * reader produces these; everything downstream is shared.
 */
interface RawPkg {
  name: string;
  version: string;
  automatic: boolean;
  installDate: string;
  size: number;
  desc: string;
  /** Unresolved dependency patterns, as the database records them. */
  deps: string[];
  /** Unresolved `provides` patterns, for satisfying virtual dependencies. */
  provides: string[];
  files: PkgFiles;
}

/**
 * Builds the dependency graph and path indexes from raw records.
 *
 * Shared by both database readers, because the interesting logic — resolving
 * dependency patterns through `provides`, inverting to reverse dependencies, and the
 * protected closure — is identical whichever manager supplied the facts. Only the
 * parsing differs.
 */
function buildIndex(manager: NativeManager, raw: RawPkg[], seeds: string[]): PkgIndex {
  const pkgs = new Map<string, PkgRecord>();
  for (const r of raw) {
    pkgs.set(r.name, {
      name: r.name,
      version: r.version,
      automatic: r.automatic,
      installDate: r.installDate,
      size: r.size,
      desc: r.desc,
      deps: [],
      revdeps: [],
      bins: r.files.bins,
      passive: r.files.passive,
    });
  }

  // A pattern that resolves to nothing installed is a virtual reference — `sh` on
  // Arch, or a soname like `libcrypto.so=3-64`. Matching those through the provides
  // table rather than dropping them is what keeps the graph connected; a missing edge
  // would make a library look unreferenced and land it on the removal list.
  const provides = new Map<string, string>();
  for (const r of raw) for (const p of r.provides) provides.set(depToName(p), r.name);

  for (const r of raw) {
    const self = pkgs.get(r.name);
    if (!self) continue;
    for (const dep of r.deps) {
      const n = depToName(dep);
      const target = pkgs.has(n) ? n : provides.get(n);
      if (!target || target === self.name) continue;
      if (!self.deps.includes(target)) self.deps.push(target);
    }
  }
  for (const p of pkgs.values()) {
    for (const d of p.deps) pkgs.get(d)?.revdeps.push(p.name);
  }

  const byPath = new Map<string, string>();
  const byName = new Map<string, string[]>();
  for (const p of pkgs.values()) {
    for (const b of p.bins) {
      // First writer wins: two packages claiming one path is a packaging bug, and
      // arbitrarily preferring the later one would make attribution unstable.
      if (!byPath.has(b)) byPath.set(b, p.name);
      const n = basename(b);
      const list = byName.get(n);
      if (list) {
        if (!list.includes(p.name)) list.push(p.name);
      } else byName.set(n, [p.name]);
    }
  }

  return { manager, pkgs, byPath, byName, protected: protectedSet(pkgs, seeds) };
}

/**
 * Reads the xbps database: one plist for the package metadata, plus one
 * `.<pkg>-files.plist` each.
 */
export function loadXbpsIndex(dbDir = XBPS_DB): PkgIndex {
  const pkgdb = readdirSync(dbDir).find((f) => /^pkgdb-[\d.]+\.plist$/.test(f));
  if (!pkgdb) throw new Error(`no pkgdb plist under ${dbDir} — is this an xbps system?`);
  const parsed = parsePlist(readFileSync(join(dbDir, pkgdb), "utf8")) as Record<string, Record<string, unknown>>;

  const raw: RawPkg[] = [];
  for (const [key, v] of Object.entries(parsed)) {
    const name = (v.pkgname as string) ?? key;
    raw.push({
      name,
      version: (v.pkgver as string) ?? "",
      automatic: v["automatic-install"] === true,
      installDate: (v["install-date"] as string) ?? "",
      size: (v.installed_size as number) ?? 0,
      desc: (v.short_desc as string) ?? "",
      deps: (v.run_depends as string[]) ?? [],
      provides: (v.provides as string[]) ?? [],
      files: scanPkgFiles(name, dbDir),
    });
  }
  return buildIndex("xbps", raw, ["base-system", "base-files", "base-voidstrap", "xbps", "glibc", "musl"]);
}

/**
 * Splits a pacman `desc`/`files` entry into its `%SECTION%` blocks.
 *
 * The format is a section header on its own line, then one value per line until a
 * blank line. Single-valued sections just happen to have one entry.
 */
export function parsePacmanDesc(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  let key: string | null = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("%") && line.endsWith("%")) {
      key = line.slice(1, -1);
      out[key] = [];
    } else if (!line) {
      key = null;
    } else if (key) {
      out[key]!.push(line);
    }
  }
  return out;
}

/**
 * Reads pacman's database: one directory per installed package under
 * `/var/lib/pacman/local`, each with a `desc` and a `files` listing.
 *
 * Two format details matter. `%REASON% 1` marks a dependency-installed package —
 * *absence* of the section means explicitly installed, so the default is "you asked
 * for it", the opposite polarity to xbps's `automatic-install`. And `files` records
 * paths relative to the root with no leading slash, with directories suffixed `/`; both
 * have to be normalised before the shared path patterns will match.
 */
export function loadPacmanIndex(dbDir = PACMAN_DB): PkgIndex {
  const entries = readdirSync(dbDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  if (!entries.length) throw new Error(`no packages under ${dbDir} — is this a pacman system?`);

  const raw: RawPkg[] = [];
  for (const e of entries) {
    const dir = join(dbDir, e.name);
    let desc: Record<string, string[]>;
    try {
      desc = parsePacmanDesc(readFileSync(join(dir, "desc"), "utf8"));
    } catch {
      // A package directory with no readable desc is a broken install, not a reason
      // to abandon the whole index.
      continue;
    }
    const name = desc.NAME?.[0];
    if (!name) continue;

    const bins = new Set<string>();
    const passive = new Set<PassiveKind>();
    try {
      for (const rel of parsePacmanDesc(readFileSync(join(dir, "files"), "utf8")).FILES ?? []) {
        if (rel.endsWith("/")) continue; // directory entry, not a file
        const p = `/${rel}`;
        if (EXEC_DIR.test(p)) {
          bins.add(p);
          continue;
        }
        for (const d of PASSIVE_DIRS) if (d.test.test(p)) passive.add(d.kind);
      }
    } catch {
      /* no files list — treat as owning nothing */
    }

    raw.push({
      name,
      version: desc.VERSION?.[0] ?? "",
      automatic: desc.REASON?.[0] === "1",
      installDate: desc.INSTALLDATE?.[0]
        ? new Date(Number(desc.INSTALLDATE[0]) * 1000).toISOString().slice(0, 16).replace("T", " ")
        : "",
      size: Number(desc.SIZE?.[0] ?? 0),
      desc: desc.DESC?.[0] ?? "",
      deps: desc.DEPENDS ?? [],
      provides: desc.PROVIDES ?? [],
      files: { bins: [...bins], passive: [...passive] },
    });
  }
  return buildIndex("pacman", raw, ["base", "pacman", "glibc", "filesystem"]);
}

/**
 * Loads whichever package database this system actually has.
 *
 * The repo is dual-boot: Void/xbps and Arch/pacman share this checkout, `/home` and
 * `~/.cache`. Dispatching on the database rather than on `/etc/os-release` means an
 * explicit `dbDir` can point at the *other* root's database, which is how the pacman
 * reader is tested from the Void boot.
 */
export function loadPkgIndex(dbDir?: string): PkgIndex {
  if (dbDir) {
    return existsSync(join(dbDir, "local")) || /pacman/.test(dbDir) ? loadPacmanIndex(dbDir) : loadXbpsIndex(dbDir);
  }
  if (existsSync(XBPS_DB)) return loadXbpsIndex();
  if (existsSync(PACMAN_DB)) return loadPacmanIndex();
  throw new Error(`no package database found (looked for ${XBPS_DB} and ${PACMAN_DB})`);
}

/**
 * Packages that must never appear as removal candidates: the dependency closure of the
 * distro's base metapackage, its package manager, libc, and every kernel.
 *
 * Taking a closure of a few seeds rather than writing a list means it stays correct as
 * the distro's base changes — and it is why the kernel pattern is matched here instead
 * of enumerated: Void names them `linux6.18`, Arch `linux`/`linux-lts`/`linux-zen`.
 */
function protectedSet(pkgs: Map<string, PkgRecord>, baseSeeds: string[]): Set<string> {
  const seeds = [...baseSeeds];
  for (const p of pkgs.keys()) if (/^linux\d|^linux-firmware|^linux$|^linux-(lts|zen|hardened)$/.test(p)) seeds.push(p);

  const out = new Set<string>();
  const stack = seeds.filter((s) => pkgs.has(s));
  while (stack.length) {
    const n = stack.pop()!;
    if (out.has(n)) continue;
    out.add(n);
    for (const d of pkgs.get(n)?.deps ?? []) if (!out.has(d)) stack.push(d);
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────────
// attribution of arbitrary paths
// ────────────────────────────────────────────────────────────────────────────────

export interface Owner {
  manager: string;
  pkg: string | null;
}

const NIX_STORE = /^\/nix\/store\/[a-z0-9]{32}-(.+?)(\/|$)/;

/**
 * Home directories of real, human users, plus this process's own.
 *
 * The collector runs as root under a supervisor that scrubs the environment, so
 * `$HOME` is either unset or `/root` — never the home of the person whose tools are
 * being attributed. Anchoring on `$HOME` silently mis-filed every user-installed
 * binary: measured on this host after 30 hours as a root service,
 * `/home/shad/.bun/bin/bun` and `/home/shad/.local/bin/iii` came back `unmanaged`
 * instead of `bun` and `local`. The `fnm` rule survived only because it happens to
 * match a path substring rather than a home prefix.
 *
 * So the homes come from the passwd database instead of the environment. uid >= 1000
 * excludes system accounts; `nologin`/`false` shells exclude service accounts that
 * still own a directory.
 */
export function humanHomes(passwd = "/etc/passwd"): string[] {
  const out = new Set<string>();
  try {
    for (const line of readFileSync(passwd, "utf8").split("\n")) {
      const [, , uidRaw, , , home, shell] = line.split(":");
      const uid = Number(uidRaw);
      if (!home || !Number.isFinite(uid) || uid < 1000 || uid >= 65534) continue;
      if (shell && /(nologin|\/false)$/.test(shell)) continue;
      if (home === "/" || !home.startsWith("/")) continue;
      out.add(home.replace(/\/$/, ""));
    }
  } catch {
    /* no passwd readable — fall back to the environment alone */
  }
  // Keep the invoking user's home too, for a home outside the passwd convention.
  if (HOME_DIR.startsWith("/")) out.add(HOME_DIR.replace(/\/$/, ""));
  return [...out];
}

let homesCache: string[] | undefined;

/**
 * The part of `path` under some user's home, or null. Returns e.g. `.cargo/bin/dua`
 * so the caller can test manager-specific subpaths without knowing whose home it was.
 */
function underHome(path: string, homes: string[]): string | null {
  for (const h of homes) {
    if (path.startsWith(`${h}/`)) return path.slice(h.length + 1);
  }
  return null;
}

/**
 * Which manager, if any, is responsible for a path.
 *
 * Everything that is not a distro package still matters: a tool installed three
 * different ways is a maintenance problem, and one dropped into ~/.local/bin by hand
 * will never be upgraded by anything. Bucketing them explicitly is what lets the
 * report say so.
 */
export function ownerOf(path: string, index: PkgIndex, homes = (homesCache ??= humanHomes())): Owner {
  const native = index.byPath.get(path);
  if (native) return { manager: index.manager, pkg: native };

  const nix = NIX_STORE.exec(path);
  if (nix) return { manager: "nix", pkg: nix[1]! };

  const name = basename(path);
  // Checked before the home rules: a version manager's tree can live under a cache
  // directory that is itself inside a home, and the manager is the useful answer.
  if (path.includes("/fnm_multishells/") || path.includes("/managed-fnm/")) return { manager: "fnm", pkg: name };

  const rel = underHome(path, homes);
  if (rel) {
    // `dot cache` redirects each toolchain's cache into ~/.cache/managed-<tool> (13 of
    // them here) and symlinks the conventional location at it — ~/.cargo is a symlink
    // to ~/.cache/managed-cargo. /proc/PID/exe reports the *resolved* path, so the
    // conventional-name rules below never match anything the collector actually sees:
    // the freshly cargo-installed atuin came back `unmanaged`, as did rustup's cargo
    // and rustc. The directory name is the tool name, so one rule covers the whole
    // namespace and any future addition to it.
    const managed = /^\.cache\/managed-([a-z0-9]+)\//.exec(rel);
    if (managed) return { manager: managed[1]!, pkg: name };

    // Conventional locations, for hosts where `dot cache` has not redirected them.
    if (rel.startsWith(".cargo/bin/")) return { manager: "cargo", pkg: name };
    if (rel.startsWith(".bun/bin/")) return { manager: "bun", pkg: name };
    if (rel.startsWith(".bun/install/global/")) return { manager: "bun", pkg: name };
    if (rel.startsWith("go/bin/")) return { manager: "go", pkg: name };
    if (rel.startsWith(".local/share/pnpm/")) return { manager: "pnpm", pkg: name };
    if (rel.startsWith(".local/share/uv/")) return { manager: "uv", pkg: name };
    if (rel.startsWith(".local/bin/")) return { manager: "local", pkg: name };
  }

  if (path.startsWith("/usr/local/")) return { manager: "local", pkg: name };
  if (path.startsWith("/opt/")) return { manager: "opt", pkg: path.split("/")[2] ?? name };

  // A path inside a package-owned tree that is not itself a listed file — a
  // wrapper written by a post-install script, say.
  return { manager: "unmanaged", pkg: null };
}

// ────────────────────────────────────────────────────────────────────────────────
// store
// ────────────────────────────────────────────────────────────────────────────────

const SCHEMA = `
CREATE TABLE IF NOT EXISTS bin (
  id       INTEGER PRIMARY KEY,
  key      TEXT NOT NULL UNIQUE,
  name     TEXT NOT NULL,
  manager  TEXT,
  pkg      TEXT
);
CREATE INDEX IF NOT EXISTS bin_pkg  ON bin(manager, pkg);
CREATE INDEX IF NOT EXISTS bin_name ON bin(name);

CREATE TABLE IF NOT EXISTS usage (
  bin_id     INTEGER NOT NULL REFERENCES bin(id) ON DELETE CASCADE,
  source     TEXT    NOT NULL,
  first_seen INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL,
  count      INTEGER NOT NULL DEFAULT 0,
  seconds    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bin_id, source)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

export interface UsageStore {
  db: Database;
  path: string;
  record(obs: Observation[], index: PkgIndex): number;
  getMeta(key: string): string | null;
  setMeta(key: string, value: string): void;
  close(): void;
}

/**
 * Recomputes `bin.manager` / `bin.pkg` for every recorded executable, returning how
 * many rows changed.
 *
 * Attribution is a pure function of (path, package index), so the columns are a cache,
 * not a fact — and a stale cache is exactly what the `$HOME` bug produced: 30 hours of
 * rows where `/home/shad/.bun/bin/bun` was filed `unmanaged`, frozen in place because a
 * `bin` row is only ever written once, when its path is first seen.
 *
 * Refreshing on every index load makes that self-healing instead of needing a migration,
 * and it also picks up ordinary churn: a binary that moves from ~/.local/bin into a
 * distro package should stop being reported as hand-dropped.
 */
export function refreshAttribution(store: UsageStore, index: PkgIndex): number {
  const rows = store.db
    .query<{ id: number; key: string; manager: string | null; pkg: string | null }, []>(
      "SELECT id, key, manager, pkg FROM bin",
    )
    .all();
  const update = store.db.query<never, [string, string | null, number]>("UPDATE bin SET manager = ?, pkg = ? WHERE id = ?");

  let changed = 0;
  const tx = store.db.transaction(() => {
    for (const r of rows) {
      const owner = r.key.startsWith("/") ? ownerOf(r.key, index) : nameOwner(r.key.slice(r.key.indexOf(":") + 1), index);
      if (owner.manager === r.manager && owner.pkg === (r.pkg ?? null)) continue;
      update.run(owner.manager, owner.pkg, r.id);
      changed++;
    }
  });
  tx();
  return changed;
}

/** Picks the system db when it exists (or can be created), else the per-user one. */
export function resolveDbPath(explicit?: string, forWrite = false): string {
  if (explicit) return explicit;
  if (existsSync(USAGE_DB)) return USAGE_DB;
  if (forWrite) {
    try {
      mkdirSync(USAGE_DIR, { recursive: true });
      return USAGE_DB;
    } catch {
      /* not root — fall through */
    }
  }
  return USER_USAGE_DB;
}

export function openStore(path: string, readonly = false): UsageStore {
  if (!readonly) mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, readonly ? { readonly: true } : { create: true });
  if (!readonly) {
    // WAL so a report reading the db never blocks the collector writing it.
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
    db.exec(SCHEMA);
  }

  const selBin = db.query<{ id: number }, [string]>("SELECT id FROM bin WHERE key = ?");
  const insBin = db.query<{ id: number }, [string, string, string, string | null]>(
    "INSERT INTO bin (key, name, manager, pkg) VALUES (?, ?, ?, ?) RETURNING id",
  );
  const upsert = db.query<never, [number, string, number, number, number, number]>(`
    INSERT INTO usage (bin_id, source, first_seen, last_seen, count, seconds)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (bin_id, source) DO UPDATE SET
      first_seen = MIN(first_seen, excluded.first_seen),
      last_seen  = MAX(last_seen,  excluded.last_seen),
      count      = count   + excluded.count,
      seconds    = seconds + excluded.seconds
  `);

  const ids = new Map<string, number>();
  const binId = (key: string, index: PkgIndex): number => {
    const hit = ids.get(key);
    if (hit !== undefined) return hit;
    const found = selBin.get(key);
    if (found) {
      ids.set(key, found.id);
      return found.id;
    }
    const isPath = key.startsWith("/");
    const name = isPath ? basename(key) : key.slice(key.indexOf(":") + 1);
    const owner = isPath ? ownerOf(key, index) : nameOwner(name, index);
    const id = insBin.get(key, name, owner.manager, owner.pkg)!.id;
    ids.set(key, id);
    return id;
  };

  const store: UsageStore = {
    db,
    path,
    record(obs, index) {
      if (!obs.length) return 0;
      const tx = db.transaction((batch: Observation[]) => {
        for (const o of batch) {
          upsert.run(binId(o.key, index), o.source, o.when, o.when, o.count, o.seconds ?? 0);
        }
      });
      tx(obs);
      return obs.length;
    },
    getMeta(key) {
      return db.query<{ value: string }, [string]>("SELECT value FROM meta WHERE key = ?").get(key)?.value ?? null;
    },
    setMeta(key, value) {
      db.query("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(
        key,
        value,
      );
    },
    close() {
      db.close();
    },
  };
  return store;
}

/**
 * Attribution for a name-only sighting (a `comm` from process accounting, or the
 * first word of a shell command). Unambiguous only when exactly one package owns an
 * executable by that name; otherwise the sighting still counts, but for no package,
 * because guessing between candidates would put fake usage on the loser.
 */
export function nameOwner(name: string, index: PkgIndex): Owner {
  const owners = index.byName.get(name);
  if (owners?.length === 1) return { manager: index.manager, pkg: owners[0]! };
  if (owners && owners.length > 1) return { manager: "ambiguous", pkg: null };
  return { manager: "unknown", pkg: null };
}

// ────────────────────────────────────────────────────────────────────────────────
// source: /proc
// ────────────────────────────────────────────────────────────────────────────────

export interface ProcSample {
  observations: Observation[];
  /** PIDs seen. */
  total: number;
  /** PIDs whose /proc/PID/exe could be read — the rest need root. */
  resolved: number;
}

/**
 * One poll of /proc. Costs ~3 ms for 625 PIDs, so a short interval is affordable.
 *
 * `seconds` is credited as the poll interval per process still running, which makes
 * the accumulated total a genuine "wall time this binary was up" figure rather than
 * a bare sighting count. Kernel threads have no `exe` link and are skipped for free.
 */
export function sampleProc(intervalSec: number, now = Math.floor(Date.now() / 1000)): ProcSample {
  const observations: Observation[] = [];
  let total = 0;
  let resolved = 0;
  for (const d of readdirSync("/proc")) {
    if (d.charCodeAt(0) < 48 || d.charCodeAt(0) > 57) continue;
    total++;
    let exe: string;
    try {
      exe = readlinkSync(`/proc/${d}/exe`);
    } catch {
      continue;
    }
    resolved++;
    // A binary replaced by an update leaves the old inode mapped; the kernel marks
    // it. The pre-upgrade path is still the right identity for usage purposes.
    if (exe.endsWith(" (deleted)")) exe = exe.slice(0, -10);
    if (!exe.startsWith("/")) continue;
    observations.push({ key: exe, source: "proc", when: now, count: 1, seconds: intervalSec });
  }
  return { observations, total, resolved };
}

// ────────────────────────────────────────────────────────────────────────────────
// source: BSD process accounting
// ────────────────────────────────────────────────────────────────────────────────

/** Size of `struct acct_v3` — the only layout this kernel writes (ACCT_VERSION 3). */
export const ACCT_V3_SIZE = 64;
const ACCT_COMM = 16;

export interface AcctRecord {
  comm: string;
  uid: number;
  pid: number;
  /** Unix seconds at process start. */
  btime: number;
  /** Wall-clock lifetime in seconds. */
  etime: number;
  exitcode: number;
}

/**
 * Decodes `struct acct_v3` records (see kernel `include/uapi/linux/acct.h`):
 *
 *   0  u8  ac_flag       8  u32 ac_uid      24 u32 ac_btime    48 char ac_comm[16]
 *   1  u8  ac_version   12  u32 ac_gid      28 f32 ac_etime
 *   2  u16 ac_tty       16  u32 ac_pid      32 comp_t ×8 (u16 each)
 *   4  u32 ac_exitcode  20  u32 ac_ppid
 *
 * Records with a version byte that is not 3 are skipped rather than trusted: a
 * mismatch means the layout is not the one above, and misparsing would invent usage.
 */
export function parseAcct(buf: Uint8Array): AcctRecord[] {
  const out: AcctRecord[] = [];
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (let off = 0; off + ACCT_V3_SIZE <= buf.length; off += ACCT_V3_SIZE) {
    // The version byte carries ACCT_BYTEORDER in its high bit on big-endian hosts.
    if ((view.getUint8(off + 1) & 0x7f) !== 3) continue;
    let end = off + 48;
    while (end < off + 48 + ACCT_COMM && buf[end] !== 0) end++;
    const comm = new TextDecoder().decode(buf.subarray(off + 48, end));
    if (!comm) continue;
    out.push({
      comm,
      uid: view.getUint32(off + 8, true),
      pid: view.getUint32(off + 16, true),
      btime: view.getUint32(off + 24, true),
      etime: view.getFloat32(off + 28, true),
      exitcode: view.getUint32(off + 4, true),
    });
  }
  return out;
}

export interface AcctIngest {
  observations: Observation[];
  records: number;
  bytes: number;
}

/**
 * Reads and then truncates the accounting file.
 *
 * Truncation is what keeps it bounded — at 64 bytes per exiting process an untended
 * file grows by megabytes a day. It is safe because the kernel opens the file
 * O_APPEND in `acct_on()`, so its writes are positioned at the current end of file
 * regardless of what we do to the length; after a truncate the next record simply
 * lands at offset 0. We are the only consumer, so nothing else loses data.
 */
export function ingestAcct(file = PACCT_FILE): AcctIngest {
  if (!existsSync(file)) return { observations: [], records: 0, bytes: 0 };
  const buf = new Uint8Array(readFileSync(file));
  if (!buf.length) return { observations: [], records: 0, bytes: 0 };
  const records = parseAcct(buf);
  truncateSync(file, 0);

  // Collapse to one observation per comm: 50k records a day is normal and inserting
  // each individually would dominate the tick.
  const agg = new Map<string, Observation>();
  for (const r of records) {
    const key = `comm:${r.comm}`;
    const when = r.btime + Math.max(0, Math.round(r.etime));
    const hit = agg.get(key);
    if (hit) {
      hit.count++;
      hit.seconds = (hit.seconds ?? 0) + Math.max(0, Math.round(r.etime));
      if (when > hit.when) hit.when = when;
    } else {
      agg.set(key, { key, source: "acct", when, count: 1, seconds: Math.max(0, Math.round(r.etime)) });
    }
  }
  return { observations: [...agg.values()], records: records.length, bytes: buf.length };
}

/**
 * Turns kernel process accounting on (path) or off (null) via `acct(2)`.
 *
 * Called through libc rather than by shelling out to `accton`, because GNU acct is
 * not installed here and its only role would be to make this one syscall — we parse
 * the records ourselves either way. Requires CAP_SYS_PACCT, i.e. root.
 */
export function setAcct(path: string | null): { ok: boolean; error?: string } {
  if (path) {
    try {
      mkdirSync(dirname(path), { recursive: true });
      // acct(2) will not create the file; it only opens an existing one O_APPEND.
      if (!existsSync(path)) writeFileSync(path, "", { mode: 0o600 });
    } catch (e) {
      return { ok: false, error: `cannot create ${path}: ${(e as Error).message}` };
    }
  }
  // Void ships glibc as libc.so.6; the musl flavour of the distro names it
  // differently, so pick whichever soname is actually present.
  const soname = ["libc.so.6", "libc.musl-x86_64.so.1", "libc.so"].find((c) => existsSync(join("/usr/lib", c)));
  if (!soname) return { ok: false, error: "no libc found under /usr/lib" };

  const lib = dlopen(soname, { acct: { args: [FFIType.cstring], returns: FFIType.i32 } });
  try {
    // bun:ffi marshals a cstring argument from a NUL-terminated buffer, not a JS
    // string; `null` is passed through as NULL, which is how acct(2) is turned off.
    if (lib.symbols.acct(path === null ? null : Buffer.from(`${path}\0`)) !== 0) {
      return { ok: false, error: path ? "acct(2) failed — needs root (CAP_SYS_PACCT)" : "acct(2) off failed" };
    }
    return { ok: true };
  } finally {
    lib.close();
  }
}

/** Whether the kernel is currently writing accounting records for us. */
export function acctActive(file = PACCT_FILE): boolean {
  if (!existsSync(file)) return false;
  // The kernel does not expose "accounting is on" anywhere readable, so the test is
  // behavioural: a file that grows without anyone writing it means the kernel is.
  const before = statSync(file).size;
  Bun.spawnSync(["true"]);
  try {
    return statSync(file).size > before;
  } catch {
    return false;
  }
}

// ────────────────────────────────────────────────────────────────────────────────
// source: atime
// ────────────────────────────────────────────────────────────────────────────────

export interface AtimeScan {
  /** Trustworthy observations only — clump hours are excluded, not flagged. */
  observations: Observation[];
  /** Executables that exist and were stat-able. */
  scanned: number;
  missing: number;
  /** Observations discarded for falling inside a clump hour. */
  discarded: number;
  /** The clump hours themselves, as unix seconds at the top of the hour. */
  clumpHours: number[];
  /** Human-readable explanation when anything was discarded, else null. */
  warning: string | null;
}

/**
 * An hour holding this share of every package executable did not get there by
 * someone using the software. Measured on this host: 1827 executables total, with
 * 1073 of them (59%) sharing the single hour 2026-06-28T22 — one sweep, six weeks
 * ago. Real use is spread out; even a busy boot touches nowhere near 15% of the
 * 1827 distinct package executables, so that is a safe floor.
 */
const ATIME_CLUMP_SHARE = 0.15;

/**
 * Last-access time of every package-owned executable.
 *
 * `stat` does not itself update atime, so scanning is free of the very effect it
 * measures. `/` is relatime, which updates atime only when the old value predates
 * mtime or is over 24h stale — day granularity, fine for a 90-day question.
 *
 * A full-tree read (backup, `xbps-pkgdb -a`, unscoped `grep -r /usr`) rewrites
 * thousands of atimes to one instant. Rather than distrust atime wholesale
 * afterwards, this drops only the observations inside such a clump: an atime that is
 * *older* than a sweep means the sweep never reached that file, and one that is
 * *newer* means genuine access since. Both remain true. Only the values sitting in
 * the clump itself carry no information, and those become "no data" — which lets the
 * other three sources decide rather than asserting a use that never happened.
 */
export function scanAtimes(index: PkgIndex, now = Math.floor(Date.now() / 1000)): AtimeScan {
  const found: { path: string; at: number }[] = [];
  const hours = new Map<number, number>();
  let scanned = 0;
  let missing = 0;

  for (const path of index.byPath.keys()) {
    let st;
    try {
      st = statSync(path);
    } catch {
      missing++;
      continue;
    }
    if (!st.isFile()) continue;
    scanned++;
    const at = Math.floor(st.atimeMs / 1000);
    // A clock skew or a filesystem without atime can hand back nonsense; a value in
    // the future is not evidence of anything.
    if (at <= 0 || at > now + 86400) continue;
    found.push({ path, at });
    const h = Math.floor(at / 3600);
    hours.set(h, (hours.get(h) ?? 0) + 1);
  }

  const threshold = scanned * ATIME_CLUMP_SHARE;
  const clumps = new Set([...hours].filter(([, n]) => n >= threshold).map(([h]) => h));

  const observations: Observation[] = [];
  for (const f of found) {
    if (clumps.has(Math.floor(f.at / 3600))) continue;
    observations.push({ key: f.path, source: "atime", when: f.at, count: 1, seconds: 0 });
  }

  const discarded = found.length - observations.length;
  const clumpHours = [...clumps].map((h) => h * 3600).sort((a, b) => a - b);
  return {
    observations,
    scanned,
    missing,
    discarded,
    clumpHours,
    warning: discarded
      ? `discarded ${discarded} of ${found.length} atimes: ${clumpHours.length} hour(s) (${clumpHours
          .map((h) => new Date(h * 1000).toISOString().slice(0, 13).replace("T", " ") + "h")
          .join(", ")}) each hold >=${(ATIME_CLUMP_SHARE * 100).toFixed(0)}% of all executables, i.e. a full-tree read, not use`
      : null,
  };
}

// ────────────────────────────────────────────────────────────────────────────────
// source: shell history
// ────────────────────────────────────────────────────────────────────────────────

export const ATUIN_DB = join(HOME_DIR, ".local/share/atuin/history.db");

/**
 * Every atuin history database on the machine, one per human user.
 *
 * The collector is a root service, so `ATUIN_DB` — which is `$HOME`-derived — points
 * at `/root/.local/share/atuin/history.db`, a file that does not exist. The symptom
 * was silent: `dot usage status` simply reported `history  no data` after 30 hours of
 * otherwise-healthy collection, and `history:cursor` stayed at 0. Enumerating homes
 * from the passwd database instead means the service reads the histories of the people
 * who actually typed the commands.
 */
export function atuinDbs(homes = humanHomes()): string[] {
  return homes.map((h) => join(h, ".local/share/atuin/history.db")).filter((p) => existsSync(p));
}

/**
 * Words that are the shell itself, not software. `cd` and `z` ranked 4th and 7th by
 * frequency on this host's history before this filter existed, which is true but
 * useless: no package owns them, so they can never be used or unused. Keeping them
 * out means every row in the report names something installed.
 *
 * Only unambiguous cases are listed. A name that is *both* a builtin and a real
 * binary (`time`, `kill`, `test`, `echo`, `printf`) stays counted, because the
 * package that ships it is real and the usage evidence is not worth discarding over
 * which one the shell picked.
 */
const SHELL_WORDS: Record<string, true> = {
  cd: true, z: true, source: true, alias: true, unalias: true, export: true, unset: true,
  set: true, setopt: true, unsetopt: true, local: true, typeset: true, declare: true,
  readonly: true, shift: true, return: true, break: true, continue: true, eval: true,
  fg: true, bg: true, jobs: true, wait: true, disown: true, suspend: true, hash: true,
  bindkey: true, zle: true, zmodload: true, autoload: true, compdef: true, emulate: true,
  fc: true, history: true, dirs: true, pushd: true, popd: true, umask: true, ulimit: true,
  trap: true, let: true, read: true, getopts: true, shopt: true, complete: true,
  if: true, fi: true, else: true, elif: true, for: true, while: true, until: true,
  case: true, esac: true, done: true, function: true, in: true, select: true, repeat: true,
  coproc: true, noglob: true, nocorrect: true,
};

/**
 * Splits a shell command line into the program names it invokes.
 *
 * Pipelines, `&&`, `sudo`, and `env VAR=x cmd` all hide the interesting name behind
 * something else, so a naive "first word" reading badly undercounts: it would
 * attribute the whole of `sudo xbps-install -Su` to sudo. Assignments and options
 * are dropped, and known prefix commands are stepped through to the real program.
 */
const PREFIX_CMDS: Record<string, true> = {
  sudo: true,
  doas: true,
  env: true,
  command: true,
  nohup: true,
  time: true,
  nice: true,
  ionice: true,
  xargs: true,
  exec: true,
  builtin: true,
};

export function commandsIn(line: string): string[] {
  const out: string[] = [];
  for (const segment of line.split(/\|\||&&|[|;]|\$\(|\)|\bthen\b|\bdo\b/)) {
    const words = segment.trim().split(/\s+/).filter(Boolean);
    let i = 0;
    for (;;) {
      // Skip leading VAR=value assignments and any option flags.
      while (i < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]!) || words[i]!.startsWith("-"))) i++;
      if (i >= words.length) break;
      const w = words[i]!;
      const name = w.includes("/") ? basename(w) : w;
      if (!/^[\w.+-]+$/.test(name)) break;
      if (!SHELL_WORDS[name]) out.push(name);
      if (PREFIX_CMDS[name]) {
        i++;
        continue;
      }
      break;
    }
  }
  return out;
}

export interface HistoryImport {
  observations: Observation[];
  rows: number;
  /** Newest timestamp consumed, so the next import can resume from here. */
  cursor: number;
}

/**
 * Imports atuin history newer than `since` (nanosecond timestamps, as atuin stores
 * them). This is the only source with retroactive per-command timestamps, and on
 * this host it starts with 32k commands over six months, which is what makes the
 * first report useful instead of empty.
 *
 * On this machine /home is a shared btrfs subvolume, so the history also contains
 * commands typed under the Arch install next door — `pacman`, `yay`, `systemctl`
 * all show up while booted into Void. That is deliberately left in. Attribution
 * goes through `nameOwner`, which resolves against *installed* packages only, so an
 * Arch-only command lands under manager `unknown` and can never credit a Void
 * package. Where a name exists on both, the effect is to mark it used — the safe
 * direction, and arguably the correct one for shared software.
 */
export function importHistory(index: PkgIndex, since = 0, dbPath = ATUIN_DB): HistoryImport {
  if (!existsSync(dbPath)) return { observations: [], rows: 0, cursor: since };
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db
      .query<{ command: string; timestamp: number }, [number]>(
        "SELECT command, timestamp FROM history WHERE timestamp > ? AND deleted_at IS NULL ORDER BY timestamp",
      )
      .all(since);

    const agg = new Map<string, Observation>();
    let cursor = since;
    for (const r of rows) {
      if (r.timestamp > cursor) cursor = r.timestamp;
      const when = Math.floor(r.timestamp / 1e9);
      for (const name of commandsIn(r.command)) {
        const key = `comm:${name}`;
        const hit = agg.get(key);
        if (hit) {
          hit.count++;
          if (when > hit.when) hit.when = when;
        } else agg.set(key, { key, source: "history", when, count: 1, seconds: 0 });
      }
    }
    return { observations: [...agg.values()], rows: rows.length, cursor };
  } finally {
    db.close();
  }
}

// ────────────────────────────────────────────────────────────────────────────────
// aggregation and the unused verdict
// ────────────────────────────────────────────────────────────────────────────────

export interface BinUsage {
  key: string;
  name: string;
  manager: string;
  pkg: string | null;
  lastSeen: number;
  firstSeen: number;
  count: number;
  seconds: number;
  sources: Source[];
  /** last_seen considering only sources a filesystem scan cannot forge. */
  hardLastSeen: number;
}

export function loadUsage(db: Database): BinUsage[] {
  const rows = db
    .query<
      {
        key: string;
        name: string;
        manager: string | null;
        pkg: string | null;
        source: Source;
        first_seen: number;
        last_seen: number;
        count: number;
        seconds: number;
      },
      []
    >(
      `SELECT b.key, b.name, b.manager, b.pkg, u.source, u.first_seen, u.last_seen, u.count, u.seconds
         FROM usage u JOIN bin b ON b.id = u.bin_id`,
    )
    .all();

  const merged = new Map<string, BinUsage>();
  for (const r of rows) {
    let e = merged.get(r.key);
    if (!e) {
      e = {
        key: r.key,
        name: r.name,
        manager: r.manager ?? "unknown",
        pkg: r.pkg,
        lastSeen: 0,
        firstSeen: Infinity,
        count: 0,
        seconds: 0,
        sources: [],
        hardLastSeen: 0,
      };
      merged.set(r.key, e);
    }
    e.lastSeen = Math.max(e.lastSeen, r.last_seen);
    e.firstSeen = Math.min(e.firstSeen, r.first_seen);
    e.count += r.count;
    e.seconds += r.seconds;
    if (!e.sources.includes(r.source)) e.sources.push(r.source);
    if (HARD_SOURCES.includes(r.source)) e.hardLastSeen = Math.max(e.hardLastSeen, r.last_seen);
  }
  return [...merged.values()];
}

export interface PkgUsage {
  pkg: string;
  lastSeen: number;
  hardLastSeen: number;
  count: number;
  seconds: number;
  bins: number;
}

/**
 * Rolls per-executable usage up to per-package usage, for the distro's own package
 * manager only. Usage recorded against nix, cargo, bun or a hand-dropped binary is
 * real and shown in `report`, but no dependency graph exists for it, so it can never
 * support a removal claim.
 */
export function usageByPkg(bins: BinUsage[], manager: NativeManager): Map<string, PkgUsage> {
  const out = new Map<string, PkgUsage>();
  for (const b of bins) {
    if (!b.pkg || b.manager !== manager) continue;
    let e = out.get(b.pkg);
    if (!e) {
      e = { pkg: b.pkg, lastSeen: 0, hardLastSeen: 0, count: 0, seconds: 0, bins: 0 };
      out.set(b.pkg, e);
    }
    e.lastSeen = Math.max(e.lastSeen, b.lastSeen);
    e.hardLastSeen = Math.max(e.hardLastSeen, b.hardLastSeen);
    e.count += b.count;
    e.seconds += b.seconds;
    e.bins++;
  }
  return out;
}

export type UnusedReason =
  /** Manually installed, never observed, and nothing needed depends on it. */
  | "manual-unused"
  /**
   * Pulled in as a dependency, and nothing still wanted requires it — transitively, so
   * this is a superset of `xbps-query -O`, which only sees packages with no dependants
   * at all rather than none that survive.
   */
  | "orphaned"
  /**
   * A library you installed deliberately that ships no executables and that nothing
   * needs — `openssl-devel`, `libxcb-devel`. Not "any .so": a dependency-installed
   * library with no live dependants is `orphaned`.
   */
  | "dead-library"
  /**
   * Consumed by something other than `exec` — kernel firmware, initramfs, a dlopen
   * registry, the 32-bit interpreter, a plugin host, an enabled service. Execution
   * evidence cannot speak to these at all, so they are reported apart from the
   * removal candidates rather than mixed in with them.
   */
  | "passive";

export interface UnusedPkg {
  pkg: PkgRecord;
  reason: UnusedReason;
  lastSeen: number;
  /** Dependants that are themselves unused — removing the pkg means removing these too. */
  unusedRevdeps: string[];
}

export interface UnusedResult {
  candidates: UnusedPkg[];
  /** Packages kept because something in use depends on them. */
  keptByDependency: number;
  /** Packages with a usage record inside the window. */
  used: number;
  /** In the protected closure (base-system, kernel, xbps). */
  protectedCount: number;
  windowStart: number;
  /**
   * How far back each source's evidence actually reaches, as unix seconds of the
   * earliest observation it holds. A source missing here has never recorded
   * anything, and one whose value is later than `windowStart` cannot answer the
   * question being asked — see `underCovered`.
   */
  evidenceSince: Partial<Record<Source, number>>;
  /**
   * Sources that cannot see the whole requested window. Non-empty means candidates
   * are provisional: nothing has been watching long enough to prove absence of use.
   */
  underCovered: Source[];
}

/**
 * Which packages nothing needs any more.
 *
 * The load-bearing step is dependency propagation. Judging packages individually
 * would flag every shared library on the system, since a .so is never `exec`d and
 * so can never be "used" — 710 of the 827 packages here are automatic dependencies.
 * So usage is seeded on packages that were actually run and then pushed *down* the
 * dependency graph: anything reachable from something in use is needed, transitively.
 * What remains is genuinely unreferenced.
 *
 * Absence of evidence is only evidence of absence once something has been watching
 * for the whole window, which is why `evidenceSince`/`underCovered` come back with
 * the answer instead of being left for the caller to guess. A fresh install has
 * minutes of `proc` data and would otherwise "prove" that nearly everything is
 * unused.
 *
 * `trustAtime` turns off the one source a filesystem sweep can corrupt. `scanAtimes`
 * already drops sweep-flattened values, so the default is on; turning it off is for
 * asking the stricter question "what has been *exec'd*".
 */
export function findUnused(
  index: PkgIndex,
  bins: BinUsage[],
  opts: { days: number; now?: number; trustAtime?: boolean } = { days: 90 },
): UnusedResult {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const windowStart = now - opts.days * 86400;
  const trustAtime = opts.trustAtime !== false;
  const byPkg = usageByPkg(bins, index.manager);

  const lastSeenOf = (p: string): number => {
    const u = byPkg.get(p);
    if (!u) return 0;
    return trustAtime ? u.lastSeen : u.hardLastSeen;
  };

  // Seed: packages run inside the window. Then walk down `deps` — everything a used
  // package needs is needed, however deep.
  const needed = new Set<string>();
  const stack: string[] = [];
  let used = 0;
  for (const p of index.pkgs.keys()) {
    if (lastSeenOf(p) >= windowStart) {
      used++;
      stack.push(p);
    }
  }
  for (const p of index.protected) stack.push(p);
  while (stack.length) {
    const n = stack.pop()!;
    if (needed.has(n)) continue;
    needed.add(n);
    for (const d of index.pkgs.get(n)?.deps ?? []) if (!needed.has(d)) stack.push(d);
  }

  const candidates: UnusedPkg[] = [];
  for (const p of index.pkgs.values()) {
    if (needed.has(p.name)) continue;
    // Two independent facts decide the label: who wanted the package, and whether it
    // has anything to execute.
    //
    // `passive` wins outright, but only when there is nothing to execute — a package
    // shipping both a binary and a service unit is judgeable by exec, since the unit
    // runs that binary. Its passive kinds stay on the record for the reader to weigh.
    //
    // Otherwise "who wanted it" comes first, because that is the axis the reader acts
    // on. Ordering the no-executables test above it mislabelled `wlroots0.19` as a
    // dead library when it is precisely the package `xbps-query -O` calls an orphan.
    // So `dead-library` now means what it says: a library *you* installed deliberately
    // that nothing needs — openssl-devel, libxcb-devel — rather than any .so at all.
    const reason: UnusedReason =
      p.bins.length === 0 && p.passive.length
        ? "passive"
        : p.automatic
          ? "orphaned"
          : p.bins.length === 0
            ? "dead-library"
            : "manual-unused";
    candidates.push({
      pkg: p,
      reason,
      lastSeen: lastSeenOf(p.name),
      unusedRevdeps: p.revdeps.filter((r) => !needed.has(r)),
    });
  }
  candidates.sort((a, b) => b.pkg.size - a.pkg.size);

  const evidenceSince: Partial<Record<Source, number>> = {};
  for (const b of bins) {
    for (const s of b.sources) {
      if (!trustAtime && s === "atime") continue;
      const prev = evidenceSince[s];
      if (prev === undefined || b.firstSeen < prev) evidenceSince[s] = b.firstSeen;
    }
  }
  const active = Object.keys(evidenceSince) as Source[];
  const underCovered = active.filter((s) => (evidenceSince[s] ?? now) > windowStart);

  return {
    candidates,
    keptByDependency: needed.size - used - index.protected.size,
    used,
    protectedCount: index.protected.size,
    windowStart,
    evidenceSince,
    underCovered,
  };
}

export function formatAge(ts: number, now = Math.floor(Date.now() / 1000)): string {
  if (!ts) return "never";
  const d = Math.floor((now - ts) / 86400);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 60) return `${d}d ago`;
  if (d < 730) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}
