import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  ACCT_V3_SIZE,
  commandsIn,
  depToName,
  findUnused,
  loadPacmanIndex,
  parseAcct,
  parsePacmanDesc,
  parsePlist,
  type BinUsage,
  type PkgIndex,
  type PkgRecord,
} from "./usage.ts";

let fixture: string | undefined;
afterEach(() => {
  if (fixture) rmSync(fixture, { recursive: true, force: true });
  fixture = undefined;
});

/** Builds a throwaway `/var/lib/pacman/local` tree. */
function pacmanDb(pkgs: { name: string; desc: string; files?: string }[]): string {
  fixture = mkdtempSync(join(tmpdir(), "dot-pacman-"));
  for (const p of pkgs) {
    const dir = join(fixture, `${p.name}-1.0-1`);
    mkdirSync(dir);
    writeFileSync(join(dir, "desc"), p.desc);
    if (p.files !== undefined) writeFileSync(join(dir, "files"), p.files);
  }
  return fixture;
}

describe("parsePacmanDesc", () => {
  test("reads %SECTION% blocks, single- and multi-valued", () => {
    const out = parsePacmanDesc("%NAME%\nzsh\n\n%SIZE%\n7281583\n\n%DEPENDS%\npcre2\nlibcap\ngdbm\n\n");
    expect(out.NAME).toEqual(["zsh"]);
    expect(out.SIZE).toEqual(["7281583"]);
    expect(out.DEPENDS).toEqual(["pcre2", "libcap", "gdbm"]);
  });

  test("a section present but empty is distinct from one that is absent", () => {
    const out = parsePacmanDesc("%NAME%\nx\n\n%DEPENDS%\n\n");
    expect(out.DEPENDS).toEqual([]);
    expect(out.PROVIDES).toBeUndefined();
  });
});

describe("loadPacmanIndex", () => {
  test("%REASON% polarity is inverted from xbps: absent means explicitly installed", () => {
    // Getting this backwards would label every hand-picked package an orphan.
    const db = pacmanDb([
      { name: "explicit", desc: "%NAME%\nexplicit\n\n%SIZE%\n10\n\n" },
      { name: "pulled", desc: "%NAME%\npulled\n\n%SIZE%\n10\n\n%REASON%\n1\n\n" },
    ]);
    const idx = loadPacmanIndex(db);
    expect(idx.manager).toBe("pacman");
    expect(idx.pkgs.get("explicit")?.automatic).toBe(false);
    expect(idx.pkgs.get("pulled")?.automatic).toBe(true);
  });

  test("file paths are relative with no leading slash, and directories are skipped", () => {
    const db = pacmanDb([
      {
        name: "zsh",
        desc: "%NAME%\nzsh\n\n%SIZE%\n10\n\n",
        files: "%FILES%\nusr/\nusr/bin/\nusr/bin/zsh\nusr/lib/zsh/5.9/zsh/cap.so\n",
      },
    ]);
    expect(loadPacmanIndex(db).pkgs.get("zsh")?.bins).toEqual(["/usr/bin/zsh"]);
  });

  test("soname and versioned dependencies resolve through provides", () => {
    // pacman records `libcrypto.so=3-64`, which names no package; without the provides
    // lookup openssl would come back unreferenced and land on the removal list.
    const db = pacmanDb([
      {
        name: "curl",
        desc: "%NAME%\ncurl\n\n%SIZE%\n10\n\n%DEPENDS%\nlibcrypto.so=3-64\nglibc>=2.38\n\n",
        files: "%FILES%\nusr/bin/curl\n",
      },
      {
        name: "openssl",
        desc: "%NAME%\nopenssl\n\n%SIZE%\n10\n\n%PROVIDES%\nlibcrypto.so=3-64\n\n",
      },
      { name: "glibc", desc: "%NAME%\nglibc\n\n%SIZE%\n10\n\n" },
    ]);
    const idx = loadPacmanIndex(db);
    expect(idx.pkgs.get("curl")?.deps.sort()).toEqual(["glibc", "openssl"]);
    expect(idx.pkgs.get("openssl")?.revdeps).toEqual(["curl"]);
  });

  test("a package directory with no readable desc is skipped, not fatal", () => {
    const db = pacmanDb([{ name: "good", desc: "%NAME%\ngood\n\n%SIZE%\n10\n\n" }]);
    mkdirSync(join(db, "broken-1.0-1"));
    const idx = loadPacmanIndex(db);
    expect([...idx.pkgs.keys()]).toEqual(["good"]);
  });

  test("usage is only attributed to the distro's own manager", () => {
    // A nix or cargo binary has no dependency graph, so it must never drive a pacman
    // removal verdict even when it shares a name.
    const db = pacmanDb([{ name: "ripgrep", desc: "%NAME%\nripgrep\n\n%SIZE%\n10\n\n", files: "%FILES%\nusr/bin/rg\n" }]);
    const idx = loadPacmanIndex(db);
    const nixUse: BinUsage = {
      key: "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-ripgrep/bin/rg",
      name: "rg",
      manager: "nix",
      pkg: "ripgrep",
      lastSeen: 1_800_000_000,
      firstSeen: 1_700_000_000,
      count: 99,
      seconds: 0,
      sources: ["proc"],
      hardLastSeen: 1_800_000_000,
    };
    const res = findUnused(idx, [nixUse], { days: 90, now: 1_800_000_000 });
    expect(res.candidates.map((c) => c.pkg.name)).toEqual(["ripgrep"]);
  });
});

describe("parsePlist", () => {
  test("reads the shapes xbps actually writes", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
      <plist version="1.0">
      <dict>
        <key>zsh</key>
        <dict>
          <key>pkgname</key><string>zsh</string>
          <key>installed_size</key><integer>8732875</integer>
          <key>automatic-install</key><true/>
          <key>run_depends</key>
          <array><string>glibc&gt;=2.41_1</string><string>libcap&gt;=2.24_1</string></array>
        </dict>
      </dict>
      </plist>`;
    const out = parsePlist(xml) as Record<string, Record<string, unknown>>;
    expect(out.zsh?.pkgname).toBe("zsh");
    expect(out.zsh?.installed_size).toBe(8732875);
    expect(out.zsh?.["automatic-install"]).toBe(true);
    expect(out.zsh?.run_depends).toEqual(["glibc>=2.41_1", "libcap>=2.24_1"]);
  });

  test("false and empty containers are distinguished from missing", () => {
    const out = parsePlist(
      `<plist version="1.0"><dict><key>a</key><false/><key>b</key><array/><key>c</key><string></string></dict></plist>`,
    ) as Record<string, unknown>;
    expect(out.a).toBe(false);
    expect(out.b).toEqual([]);
    expect(out.c).toBe("");
  });

  test("&amp; is decoded last so &amp;lt; survives as literal &lt;", () => {
    const out = parsePlist(`<plist version="1.0"><dict><key>k</key><string>a&amp;lt;b</string></dict></plist>`) as Record<
      string,
      unknown
    >;
    expect(out.k).toBe("a&lt;b");
  });
});

describe("depToName", () => {
  // A wrong answer here silently disconnects the dependency graph, which is what
  // stops `unused` from proposing to remove a library something still needs.
  test.each([
    ["glibc>=2.41_1", "glibc"],
    ["libcap>=2.24_1", "libcap"],
    ["wlroots0.19>=0.19.3_1", "wlroots0.19"],
    ["python3-setuptools>=0", "python3-setuptools"],
    ["base-files-0.143_5", "base-files"],
    ["foo<1.0_1", "foo"],
    ["bare", "bare"],
  ])("%s -> %s", (dep, want) => {
    expect(depToName(dep)).toBe(want);
  });
});

describe("parseAcct", () => {
  /** Builds one `struct acct_v3` the way the kernel lays it out. */
  function record(comm: string, opts: { version?: number; uid?: number; btime?: number; etime?: number } = {}) {
    const buf = new Uint8Array(ACCT_V3_SIZE);
    const dv = new DataView(buf.buffer);
    dv.setUint8(1, opts.version ?? 3);
    dv.setUint32(8, opts.uid ?? 1000, true);
    dv.setUint32(16, 4242, true);
    dv.setUint32(24, opts.btime ?? 1786000000, true);
    dv.setFloat32(28, opts.etime ?? 2.5, true);
    buf.set(new TextEncoder().encode(comm).subarray(0, 16), 48);
    return buf;
  }

  test("decodes the v3 field offsets", () => {
    const [r] = parseAcct(record("ripgrep", { uid: 1000, btime: 1786000000, etime: 2.5 }));
    expect(r).toEqual({ comm: "ripgrep", uid: 1000, pid: 4242, btime: 1786000000, etime: 2.5, exitcode: 0 });
  });

  test("a foreign version byte is skipped, not misparsed", () => {
    // Trusting a record whose layout is not v3 would invent usage out of noise.
    expect(parseAcct(record("ghost", { version: 2 }))).toEqual([]);
  });

  test("comm is read up to the NUL, and a full 16 bytes is not overrun", () => {
    const full = parseAcct(record("abcdefghijklmnop"));
    expect(full[0]?.comm).toBe("abcdefghijklmnop");
    expect(full[0]?.comm.length).toBe(16);
  });

  test("a trailing partial record is ignored rather than read past the end", () => {
    const buf = new Uint8Array(ACCT_V3_SIZE + 10);
    buf.set(record("ok"), 0);
    buf[ACCT_V3_SIZE + 1] = 3;
    expect(parseAcct(buf).map((r) => r.comm)).toEqual(["ok"]);
  });
});

describe("commandsIn", () => {
  test("steps through prefix commands to the real program", () => {
    // Counting this as usage of sudo and nothing else was the naive-parser bug.
    expect(commandsIn("sudo xbps-install -Su")).toEqual(["sudo", "xbps-install"]);
    expect(commandsIn("env FOO=1 nice -n5 rg pattern")).toEqual(["env", "nice", "rg"]);
  });

  test("every stage of a pipeline counts", () => {
    expect(commandsIn("rg foo | fzf | xargs bat")).toEqual(["rg", "fzf", "xargs", "bat"]);
  });

  test("leading assignments and separators do not hide the program", () => {
    expect(commandsIn("NODE_ENV=prod bun run build && just check")).toEqual(["bun", "just"]);
    expect(commandsIn("git commit -m x ; dot usage report")).toEqual(["git", "dot"]);
  });

  test("absolute and relative paths reduce to the program name", () => {
    expect(commandsIn("/usr/bin/nvim file")).toEqual(["nvim"]);
    expect(commandsIn("./scripts/deploy.sh")).toEqual(["deploy.sh"]);
  });

  test("shell builtins are not software", () => {
    // `cd` and `z` were the 4th and 7th most frequent entries in this host's history.
    expect(commandsIn("cd /tmp")).toEqual([]);
    expect(commandsIn("z proj && nvim .")).toEqual(["nvim"]);
    expect(commandsIn("export PATH=/x")).toEqual([]);
  });
});

// ── findUnused ──────────────────────────────────────────────────────────────────

const DAY = 86400;
const NOW = 1_800_000_000;

function pkg(name: string, over: Partial<PkgRecord> = {}): PkgRecord {
  return {
    name,
    version: `${name}-1.0_1`,
    automatic: false,
    installDate: "",
    size: 1000,
    desc: "",
    deps: [],
    revdeps: [],
    bins: [`/usr/bin/${name}`],
    passive: [],
    ...over,
  };
}

/** Builds an index with revdeps inverted from deps, as loadPkgIndex does. */
function indexOf(records: PkgRecord[], protectedNames: string[] = []): PkgIndex {
  const pkgs = new Map(records.map((r) => [r.name, r]));
  for (const p of pkgs.values()) p.revdeps = [];
  for (const p of pkgs.values()) for (const d of p.deps) pkgs.get(d)?.revdeps.push(p.name);
  const byPath = new Map<string, string>();
  const byName = new Map<string, string[]>();
  for (const p of pkgs.values()) {
    for (const b of p.bins) {
      byPath.set(b, p.name);
      byName.set(b.slice(b.lastIndexOf("/") + 1), [p.name]);
    }
  }
  return { manager: "xbps", pkgs, byPath, byName, protected: new Set(protectedNames) };
}

function usage(pkgName: string, agoDays: number, source: BinUsage["sources"][number] = "proc"): BinUsage {
  const when = NOW - agoDays * DAY;
  return {
    key: `/usr/bin/${pkgName}`,
    name: pkgName,
    manager: "xbps",
    pkg: pkgName,
    lastSeen: when,
    firstSeen: when,
    count: 1,
    seconds: 0,
    sources: [source],
    hardLastSeen: source === "atime" ? 0 : when,
  };
}

describe("findUnused", () => {
  test("a library is kept alive by a used dependant, however deep", () => {
    // This is the whole reason the tool is not just "grep atime": a .so is never
    // exec'd, so judging packages individually would nominate every library.
    const index = indexOf([
      pkg("editor", { deps: ["libmid"] }),
      pkg("libmid", { automatic: true, bins: [], deps: ["libdeep"] }),
      pkg("libdeep", { automatic: true, bins: [] }),
    ]);
    const res = findUnused(index, [usage("editor", 1)], { days: 90, now: NOW });
    expect(res.candidates.map((c) => c.pkg.name)).toEqual([]);
    expect(res.used).toBe(1);
    expect(res.keptByDependency).toBe(2);
  });

  test("when the dependant falls out of the window the whole chain becomes removable", () => {
    const index = indexOf([
      pkg("editor", { deps: ["libmid"] }),
      pkg("libmid", { automatic: true, bins: [], deps: ["libdeep"] }),
      pkg("libdeep", { automatic: true, bins: [] }),
    ]);
    const res = findUnused(index, [usage("editor", 200)], { days: 90, now: NOW });
    expect(res.candidates.map((c) => c.pkg.name).sort()).toEqual(["editor", "libdeep", "libmid"]);
    expect(res.candidates.find((c) => c.pkg.name === "editor")?.reason).toBe("manual-unused");
    expect(res.candidates.find((c) => c.pkg.name === "libmid")?.reason).toBe("orphaned");
    expect(res.candidates.find((c) => c.pkg.name === "libmid")?.unusedRevdeps).toEqual(["editor"]);
  });

  test("the protected closure is never a candidate, and pulls its deps with it", () => {
    const index = indexOf([pkg("base-system", { deps: ["libc"] }), pkg("libc", { automatic: true, bins: [] })], [
      "base-system",
    ]);
    const res = findUnused(index, [], { days: 90, now: NOW });
    expect(res.candidates).toEqual([]);
    expect(res.protectedCount).toBe(1);
  });

  test("no-exec packages with a passive consumer are classed apart", () => {
    // intel-ucode and glibc-32bit are real removal nominees under a pure exec rule.
    const index = indexOf([
      pkg("intel-ucode", { bins: [], passive: ["firmware", "initramfs"] }),
      pkg("libstale", { bins: [], automatic: true }),
    ]);
    const res = findUnused(index, [], { days: 90, now: NOW });
    const byName = new Map(res.candidates.map((c) => [c.pkg.name, c.reason]));
    expect(byName.get("intel-ucode")).toBe("passive");
    expect(byName.get("libstale")).toBe("orphaned");
  });

  test("the label matrix: who wanted it decides, before whether it has executables", () => {
    // Regression guard. Testing "no executables" first labelled wlroots0.19 — an
    // automatic library that is exactly what `xbps-query -O` calls an orphan — as a
    // `dead-library`, which reads as "you installed a library you never used".
    const index = indexOf([
      pkg("wlroots0.19", { automatic: true, bins: [] }),
      pkg("openssl-devel", { automatic: false, bins: [] }),
      pkg("texinfo", { automatic: true, bins: ["/usr/bin/texinfo"] }),
      pkg("pandoc", { automatic: false, bins: ["/usr/bin/pandoc"] }),
      pkg("intel-ucode", { automatic: false, bins: [], passive: ["firmware"] }),
      pkg("glibc-32bit", { automatic: true, bins: [], passive: ["multilib"] }),
    ]);
    const byName = new Map(findUnused(index, [], { days: 90, now: NOW }).candidates.map((c) => [c.pkg.name, c.reason]));
    expect(byName.get("wlroots0.19")).toBe("orphaned");
    expect(byName.get("openssl-devel")).toBe("dead-library");
    expect(byName.get("texinfo")).toBe("orphaned");
    expect(byName.get("pandoc")).toBe("manual-unused");
    // passive outranks both axes, whether the package was wanted or pulled in.
    expect(byName.get("intel-ucode")).toBe("passive");
    expect(byName.get("glibc-32bit")).toBe("passive");
  });

  test("a passive package that also ships a binary stays judgeable by exec", () => {
    // A service unit plus a daemon binary: the unit runs the binary, so exec
    // evidence is valid and must not be discarded as unjudgeable.
    const index = indexOf([pkg("daemonpkg", { passive: ["service"], bins: ["/usr/bin/daemonpkg"] })]);
    const res = findUnused(index, [], { days: 90, now: NOW });
    expect(res.candidates[0]?.reason).toBe("manual-unused");
  });

  test("automatic packages are orphaned, manual ones are manual-unused", () => {
    const index = indexOf([pkg("wanted"), pkg("pulled", { automatic: true })]);
    const res = findUnused(index, [], { days: 90, now: NOW });
    const byName = new Map(res.candidates.map((c) => [c.pkg.name, c.reason]));
    expect(byName.get("wanted")).toBe("manual-unused");
    expect(byName.get("pulled")).toBe("orphaned");
  });

  test("trustAtime:false drops atime evidence, so an atime-only package is unused", () => {
    const index = indexOf([pkg("scanned")]);
    const bins = [usage("scanned", 1, "atime")];
    expect(findUnused(index, bins, { days: 90, now: NOW }).candidates).toEqual([]);
    expect(findUnused(index, bins, { days: 90, now: NOW, trustAtime: false }).candidates.map((c) => c.pkg.name)).toEqual([
      "scanned",
    ]);
  });

  test("a source that has not been watching the whole window is reported under-covered", () => {
    // Absence of evidence is only evidence of absence once something was looking.
    const index = indexOf([pkg("a")]);
    const res = findUnused(index, [usage("a", 3)], { days: 90, now: NOW });
    expect(res.underCovered).toEqual(["proc"]);
    expect(res.evidenceSince.proc).toBe(NOW - 3 * DAY);

    const long = findUnused(index, [usage("a", 200)], { days: 90, now: NOW });
    expect(long.underCovered).toEqual([]);
  });

  test("candidates are ordered by reclaimable size", () => {
    const index = indexOf([pkg("small", { size: 10 }), pkg("big", { size: 1000 }), pkg("mid", { size: 100 })]);
    const res = findUnused(index, [], { days: 90, now: NOW });
    expect(res.candidates.map((c) => c.pkg.name)).toEqual(["big", "mid", "small"]);
  });
});
