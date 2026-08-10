import { existsSync } from "fs";
import { mkdir, rm } from "fs/promises";
import { join } from "path";
import { CACHE_DIR, HOME_DIR } from "../config.ts";
import { commandExists, getVersion, logError, logInfo, logSuccess } from "../console.ts";
import { spawnInherit } from "../spawn.ts";
import type { Updater } from "./types.ts";

export const lyUpdater: Updater = {
  name: "ly",
  group: "source",
  async run(check) {
    const lyDir = join(HOME_DIR, ".builds/ly");
    const lyRepo = "https://codeberg.org/fairyglade/ly.git";
    const zigCmd = existsSync(join(HOME_DIR, ".local/bin/zig")) ? join(HOME_DIR, ".local/bin/zig") : "zig";

    if (!commandExists("git")) return true;
    if (check) {
      if (existsSync(lyDir)) {
        const r = Bun.spawnSync(["git", "-C", lyDir, "rev-parse", "--short", "HEAD"], { stdout: "pipe" });
        logInfo(`ly: ${new TextDecoder().decode(r.stdout).trim()}`);
      } else {
        logInfo("ly: not cloned");
      }
      return true;
    }

    if (!existsSync(lyDir)) {
      logInfo("ly: cloning…");
      const r = await spawnInherit(["git", "clone", "--recurse-submodules", lyRepo, lyDir]);
      if (r.exitCode !== 0) { logError("ly: clone failed"); return false; }
    } else {
      logInfo("ly: fetching…");
      const subR = Bun.spawnSync(
        ["git", "-C", lyDir, "submodule", "update", "--init", "--recursive", "-q"],
        { stdout: "pipe", stderr: "pipe" },
      );
      if (subR.exitCode !== 0) {
        const err = new TextDecoder().decode(subR.stderr).trim().split("\n").slice(0, 5).join("\n");
        logError(`ly: submodule update failed\n${err}`);
        return false;
      }

      const pullR = Bun.spawnSync(
        ["git", "-C", lyDir, "pull", "-q", "--ff-only"],
        { stdout: "pipe", stderr: "pipe" },
      );
      if (pullR.exitCode !== 0) {
        const err = new TextDecoder().decode(pullR.stderr).trim().split("\n").slice(0, 5).join("\n");
        logError(`ly: git pull failed\n${err}`);
        return false;
      }
    }

    // Skip the build based on the commit that produced the installed binary, not on whether
    // this run's pull moved HEAD. A failed build leaves HEAD where it is, so once ly is
    // installed the pull-delta check would report "up to date" from then on and never retry
    // the build — a failure that happened once would look like success forever.
    const builtFile = join(CACHE_DIR, "ly.built");
    const head = new TextDecoder().decode(
      Bun.spawnSync(["git", "-C", lyDir, "rev-parse", "HEAD"], { stdout: "pipe" }).stdout,
    ).trim();
    const built = existsSync(builtFile) ? (await Bun.file(builtFile).text()).trim() : null;
    // A distro ly reappearing (`pacman -S ly`) also means not up to date: it has taken back
    // paths this build owns, and skipping would leave the two installs interleaved.
    const distroPkg = Bun.spawnSync(["pacman", "-Qq", "ly"], { stdout: "pipe", stderr: "pipe" }).exitCode === 0;

    if (built === head && !distroPkg && existsSync("/usr/bin/ly")) {
      const lyTag = new TextDecoder().decode(
        Bun.spawnSync(["git", "-C", lyDir, "describe", "--tags", "--abbrev=0"], { stdout: "pipe", stderr: "pipe" }).stdout,
      ).trim();
      logSuccess(`ly: up to date${lyTag ? ` (${lyTag})` : ""}`);
      return true;
    }

    const priv = commandExists("doas") ? "doas" : "sudo";

    // Root-owned files under the build tree are fallout from the older `sudo zig build` in
    // place: zig cannot then read its own cache entries back as us and every later build dies
    // with `unable to load 'install.zig': AccessDenied`. Staging below stops it recurring;
    // clear what the old behaviour left behind.
    const uid = process.getuid?.() ?? 0;
    const foreign = Bun.spawnSync(
      ["find", join(lyDir, ".zig-cache"), join(lyDir, "zig-out"), "!", "-uid", String(uid), "-print", "-quit"],
      { stdout: "pipe", stderr: "pipe" },
    );
    if (new TextDecoder().decode(foreign.stdout).trim()) {
      logInfo("ly: clearing root-owned build cache…");
      const r = await spawnInherit([priv, "rm", "-rf", join(lyDir, ".zig-cache"), join(lyDir, "zig-out")], { pty: false });
      if (r.exitCode !== 0) { logError("ly: could not clear build cache"); return false; }
    }

    // ReleaseSafe, not the default Debug: for a native x86_64 Debug build zig 0.16 uses its
    // self-hosted backend and its own ELF linker, which cannot relocate R_X86_64_PC64 in the
    // .sframe section GCC 16 / glibc 2.43 emit into crt1.o —
    //   error: fatal linker error: unhandled relocation type R_X86_64_PC64 at offset 0x1c
    //     note: in /usr/lib/gcc/x86_64-pc-linux-gnu/16/../../../../lib/crt1.o:.sframe
    // The release modes go through LLVM/LLD, which handles it. Upstream zig bug, and 0.16.0
    // is the newest zig there is, so no toolchain bump escapes it. A display manager also has
    // no business being installed as an unoptimized build.
    //
    // `installnoconf` writes a complete DESTDIR tree, so the compiler never needs to be root:
    // build and stage as us, then copy the tree into place. Two flags carry weight —
    // `--no-preserve=ownership`, or root would stamp our uid on /usr/bin/ly, and
    // `--remove-destination`, because /etc/ly holds `dot link` symlinks into /data and cp
    // would otherwise follow one and write through into this repo.
    const stage = join(CACHE_DIR, "ly-stage");
    await rm(stage, { recursive: true, force: true });
    await mkdir(stage, { recursive: true });

    logInfo("ly: building…");
    const build = Bun.spawnSync(
      [zigCmd, "build", "installnoconf", "-Doptimize=ReleaseSafe", `-Ddest_directory=${stage}`],
      { cwd: lyDir, stdout: "pipe", stderr: "pipe" },
    );
    if (build.exitCode !== 0) {
      process.stderr.write(build.stderr);
      logError("ly: build failed");
      return false;
    }

    // ly has exactly one owner and it is this updater. Void has no `ly` package at all; Arch
    // has one, and it installs the binary as `ly-dm` while claiming the same 28 paths this
    // build writes — /usr/lib/systemd/system/ly@.service and /etc/pam.d/ly among them. Leaving
    // both in place means pacman and this step overwrite each other on every `dot update`,
    // so the package goes. Removal is deliberately after a successful build: the tree that
    // replaces it is already staged.
    if (distroPkg) {
      logInfo("ly: removing the distro package — this build owns ly now…");
      const drop = await spawnInherit([priv, "pacman", "-R", "--noconfirm", "ly"], { pty: false });
      if (drop.exitCode !== 0) { logError("ly: could not remove the distro ly package"); return false; }
    }

    logInfo("ly: installing…");
    // pty: false — this authenticates; see `pty` in src/lib/spawn.ts.
    const install = await spawnInherit(
      [priv, "cp", "-a", "--remove-destination", "--no-preserve=ownership,context", `${stage}/.`, "/"],
      { pty: false },
    );
    if (install.exitCode !== 0) { logError("ly: install failed"); return false; }

    // `installnoconf` never writes config.ini, which is right for an update and leaves a fresh
    // machine with nothing for packages/ly/configure.sh to patch. pacman moves its copy aside
    // as .pacsave when removed, so prefer that over the pristine example.
    if (!existsSync("/etc/ly/config.ini")) {
      const seed = existsSync("/etc/ly/config.ini.pacsave") ? "/etc/ly/config.ini.pacsave" : "/etc/ly/config.ini.example";
      logInfo(`ly: seeding /etc/ly/config.ini from ${seed}`);
      const seedR = await spawnInherit([priv, "cp", "-p", seed, "/etc/ly/config.ini"], { pty: false });
      if (seedR.exitCode !== 0) { logError("ly: could not seed /etc/ly/config.ini"); return false; }
    }

    await rm(stage, { recursive: true, force: true });
    await Bun.write(builtFile, head);
    const lyVer = getVersion("ly", ["-v"]);
    logSuccess(`ly: ${lyVer || "installed"}`);
    return true;
  },
};
