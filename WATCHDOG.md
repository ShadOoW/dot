# Watchdog — `dot`

You are reviewing a dotfiles manager whose characteristic failure is **silence**. A config
that resolves to nothing is treated as _absent_, not broken, by every consumer: systemd
generators, `systemd-modules-load`, `svlogd`, `earlyoom`. Nothing errors. Rank severity by
**how long a defect stays invisible**, not by how wrong it looks in the diff.

- `blocker` — silent until a fresh boot, or destructive, or commits a credential.
- `concern` — a real invariant broken, but it fails loudly or is caught on the next run.
- `nit` — everything else. `just format` fixes formatting; don't spend a note on it.

The executor already has `AGENTS.md`. Do not restate it. Your value is the **detection
signature** and the second-order coupling that file does not list.

---

> All `src/…` paths in this document are relative to the moved CLI at
> **`/data/code/fleet/apps/dot`** (entry `apps/dot/dot.ts`); this repo has no TS of its own.

## 1. Early boot — `/data` is unmounted until `local-fs.target`

Anything systemd, the kernel, or udev reads before the mount must be a **real file**
installed from `etc-real*/`. A `dot link` symlink there resolves to nothing. Cost of record:
a 9-day silent swap outage.

| Signature in a diff                                                                                                                                                                                          | Verdict                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| New or moved path under `packages/*/system/**` whose target is `/etc/modules-load.d/`, `/etc/sysctl.d/`, `/etc/tmpfiles.d/`, `/etc/udev/rules.d/`, `/etc/vconsole.conf`, `/etc/systemd/**`, `/etc/sv/*/conf` | blocker                |
| A file moved _out of_ `etc-real*/` into `system/`                                                                                                                                                            | blocker, by definition |
| The literal `etc-real` appearing anywhere in `src/**`                                                                                                                                                        | blocker — see §5       |
| `dot doctor --fix --force` proposed near one of these paths: a real file at the target is classified `drift` and replaced with a symlink                                                                     | blocker                |

Match `etc-real*`, not `etc-real`. Three names are in use: `etc-real/`,
`etc-real-systemd/`, `etc-real-runit/`. AGENTS.md's table lists 4 files; the real inventory
is 10 across 5 packages — `journald` and `usage` are entirely undocumented there, as are
`zram`'s `/etc/sysctl.d/30-reclaim.conf` and `/etc/tmpfiles.d/zswap.conf`. A diff adding an
`etc-real*` file should add the AGENTS.md row in the same commit.

**Proof standard.** These are verified **only on a fresh boot**. `systemctl daemon-reload`
re-runs generators _after_ the mount and `sv restart` re-reads config _after_ the FS is up —
both mask exactly this class. Separately, `systemctl enable --now` on an already-running unit
does not pick up a changed `ExecStart`; demand `restart`
(`packages/oom/configure.sh:83-89` is the correct shape). If a diff's stated verification is
a reload, that is not verification: say so.

## 2. Shipped units and runit `run` scripts

The repo has already paid for each of these once.

- **Interpreter path in a version-managed dir.** `ExecStart=`/`exec`/shebang matching
  `managed-fnm`, `/.cache/`, `/.nvm/`, `/.asdf/`, `/.pyenv/`, `node_modules/.bin`,
  `/.local/share/mise`, `$HOME/.bun/bin`, or `env node|bun|python`. The alias moves, the unit
  hot-loops on `status=203/EXEC`. Under runit it is worse: `/etc/runit/2` execs
  `env - PATH=$PATH runsvdir`, so a scrubbed `PATH` cannot find a bare name. blocker.
- **`Restart=` without a start limit.** `Restart=on-failure|always` needs
  `StartLimitIntervalSec=` **and** `StartLimitBurst=`, and both belong in **`[Unit]`** —
  systemd silently ignores them in `[Service]`. A small `RestartSec` never trips the default
  5-in-10s limit, so a broken path becomes an indefinite loop instead of a failed unit.
  Correct examples: `oom-notify.service:6-7`, `polkit-agent.service:5-6`. concern, blocker if
  the exec path is also unstable.
- **runit service with no log sink.** `runsv` wires only _stdout_ to `svlogd`. A new
  `packages/**/etc/sv/<svc>/` needs a sibling `log/run`, an `exec 2>&1` in `run`, and a
  `sleep`-guarded `exit 1` preflight so a missing binary backs off instead of spinning at
  ~1 Hz. `svlogd` also exits instantly if its log dir does not exist, so `log/run` must
  create the dir itself rather than assume `configure.sh` ran. concern.
- **Void has no journal and no syslog socket.** Do not accept "the error will be in the log"
  as a defence for a runit service; stderr goes nowhere.

## 3. Real-file installers (`configure.sh`)

`install`/`cp` onto a symlink path **follows the link** and clobbers the file inside
`/data/config/dot`. Every write into `/etc` must be `rm -f "$dst"` first, then install, and
ideally a `[ -L "$dst" ]` bail. Correct shape: `fonts/configure.sh:24-25`,
`journald/configure.sh:33-37`, `zram/configure.sh:70-74`. blocker when the package also ships
a `system/` path to the same destination.

**Init detection is `[ -d /run/systemd/system ]`, never `[ -d /run/systemd ]`.** elogind
creates `/run/systemd` on Void, so the bare test reports systemd on a runit box — the script
then installs the Arch tree, never writes the runit config, and dies on
`systemctl: command not found` while looking configured. Fixed twice already (`zram`, then
`journald`). Flag any new `[ -d /run/systemd ]`, `command -v systemctl`, or `uname`-based init
probe. blocker.

## 4. The memory tiers are coupled — never review one in isolation

`zram` (compressed RAM, pri 100), `swap` (16 GiB NVMe swapfile, pri 10) and `oom`
(`earlyoom` absolute thresholds) are one system with two init-specific copies of each config.

- A change to swap **capacity** invalidates `earlyoom`'s `-S`; a change to `-M`/`-S` in one
  init's file must land in the other (`oom/etc-real-systemd/.../10-args.conf` **and**
  `oom/etc-real-runit/etc/sv/earlyoom/run`). concern.
- `-m`/`-s` (relative) instead of `-M`/`-S` (absolute KiB) makes the killer unreachable under
  load. It has already both slept through freezes and killed 177 processes in two minutes.
  blocker.
- `zram-size` above ~25% of RAM deadlocks reclaim (storing a compressed page requires
  allocating one): no OOM kill, swap 68% free, machine stops. In `zramen`'s conf an **unset**
  `ZRAM_MAX_SIZE` means _no ceiling_, not a default. blocker.
- Deleting `30-reclaim.conf` or `zswap.conf` "because the GRUB cmdline covers it" is not
  equivalent. concern.

## 5. `src/` invariants that nothing but convention enforces

- **`etc-real*` is unreachable by design, not by check.** `collectFiles` walks only
  `join(pkgDir, section)` for `section: "home" | "system"` (`src/lib/pkg.ts:170-173`), and the
  string `etc-real` appears nowhere in `src/`. Widening that union, walking `pkgDir` itself, or
  adding an `etc-real` branch to `resolveTarget` re-arms the outage. blocker.
- **`resolveTarget` has a catch-all.** `system/<x>/…` for any `<x>` outside
  `base|runit|systemd|launchd` maps to `/<x>/…` (`src/lib/pkg.ts:199-207`), and the init
  filter (`:184-186`) skips only those three exact strings. So `system/systmd/etc/foo.conf`
  links to `/systmd/etc/foo.conf` on **every** init, silently. In any package diff, the second
  segment under `system/` must be exactly `base|runit|systemd|launchd` — `packages/ly/system/etc/`
  is the one legitimate fallthrough user. Adding a new init requires coordinated edits in
  `collectFiles`, `resolveTarget`, `hasInitDirs`, `collectEnableScripts`, `declaredServices`
  and `findSystemGhosts`; a partial set is a bug.
- **PSS, never RSS.** `src/lib/memory.ts` reads `Pss`/`SwapPss` from
  `/proc/PID/smaps_rollup`; summed RSS double-counts shared node/chromium text (24.0 GiB
  reported vs 14.3 GiB true). Watch for a switch to `ps`/`statm` RSS, removal of the
  `estimated` flag that makes the RSS fallback _visible_, or deletion of the kernel-thread
  filter (which produced ~400 bogus one-process families). blocker.
- **One definition of reclaimable.** `report` and `clean` must both go through `findTargets`.
  A process-**name** allowlist is the old design that reported "nothing to reap" during a real
  OOM; rules are about process _shape and size_. Any new name regex in `sgc.ts` is a
  regression. blocker.
- **`FileEntry` drops the section**, so `unlinkPackage` re-derives privilege from
  `source.includes("/system/")` and escalates to `sudo rm -f`. A `home/` path containing a
  `system` component would be misclassified. Adding a `section` field is the fix, not the bug.

## 6. Destructive paths — read these adversarially

- `doctor --fix` prunes ghosts with `sudo rm -rf` for system paths, gated only by
  `isDotfilesPath`, which is a substring test for `/packages/` or `/dotfiles/`. Loosening it,
  widening the scan root, or trimming `protectedPaths` is a blocker.
- `link --force` does `mkdir -p dirname` then `unlink(target)`. There is no
  `realpath` containment check, so a symlinked ancestor pointing back into the repo means
  `--force` deletes a repo file. `doctor --fix --force` reaches this non-interactively for
  every package. Making `--force` the default, or adding it to a batch caller, is a blocker;
  adding a `realpathSync(...).startsWith(DOTFILES_DIR)` refusal is the fix.
- `dot kernel`'s Void/Arch partition is a bare `startsWith("linux")` on a **shared `/boot`**.
  Touching that split or bumping `KEEP_PURGEABLE` "for safety" can unbootstrap the Arch
  install. blocker.

## 7. Distro divergence belongs in a table, not an `if`

`run()` is `Bun.spawn` and **throws** on a missing binary rather than returning 127, so one
unguarded `pacman` call kills the rest of the command. And a pacman-shaped assumption on Void
produces a confident _false pass_: the drift scan looked for `*.pacnew`, which Void never
writes (its marker is `<file>.new-<version>`), printed "no drift", then threw. Flag: new
`pacman|paccache|yay|vkpurge|xbps-*` literals in `apps/dot/src/**` outside `sweep.ts`'s `SYSTEMS`
table or without a `commandExists()` probe; any `if (distro === …)` in a command that has a
table; any distro branch whose non-matching side emits _success_.

`appliesToCurrentOS` collapses everything non-macOS to `linux`, so **`os: ["linux"]` does not
exclude Void** — an Arch-only package needs `os: ["arch"]`. `meta.json` unknown keys are
warn-only and silently dropped, so `"service"` for `"services"` no-ops. 23 of 53 packages ship
no `meta.json` at all and therefore claim to apply everywhere, macOS included.

## 8. Gate blind spots — absorb these yourself

`just check` (the recipe is `check`; **`just fmt` does not exist**, it is `format`) runs
stylua/shfmt/ruff-format/prettier/kdlfmt/taplo; the CLI's `tsc --noEmit` and `bun test`
gates moved with it to `/data/code/fleet/apps/dot`. What it does **not** catch, and you
therefore must:

- **No linter of any language.** `ruff.toml` is format-only; no shellcheck, no eslint. Unquoted
  expansions, `set -euo pipefail` omissions, undefined Python names all pass.
- **The TS CLI (`/data/code/fleet/apps/dot`) has no formatter and no lint**, and its `tsconfig`
  lacks `noUncheckedIndexedAccess` — direct risk in the code parsing `/proc/*/smaps_rollup`
  and `pacman -Q` output.
- **CLI tests exist only under `apps/dot/src/lib/` (9 files).** `apps/dot/src/commands/link.ts` —
  the symlink engine — has none, nor do `sgc`/`doctor`/`sweep`/`kernel`.
- **`packages/` is never type-checked** — the old `tsconfig.include: ["dot.ts","src"]` gate was
  deleted with the CLI, and no TS remains in this repo.
- **Extensionless shell is outside `just check`** (`find -name "*.sh"`), but pre-commit's
  shfmt hook _rewrites_ it by shebang — so runit `run` scripts get reformatted by a gate that
  never validates them. `.zsh` is covered by neither.
- **Nothing verifies that a file `dot link` would install is tracked by git.** `.gitignore`
  uses unanchored directory patterns, so a package payload can be invisible while every gate
  is green. Any new `.gitignore` line without a leading `/`, and any package path containing a
  segment `backup`, `node_modules`, `.cursor`, or `__pycache__`, deserves a note.
- `taplo check` is schema validation, not a format check; unformatted TOML passes and then
  churns on the next `just format`.

## 9. Pre-existing defects — do not re-report as new

Raise these **only** if the change touches them or makes them worse. Do repeat them if a diff
walks past one while editing the same file.

| Location                                                           | Defect                                                                                                                                                                            |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/agentmemory/system/systemd/.../agentmemory.service:8-10` | Still `ExecStart=%h/.cache/managed-fnm/…`, `Restart=on-failure`, no start limit — the incident AGENTS.md describes in past tense. The runit sibling was fixed; this was not.      |
| `packages/usage/etc-real/.../dot-usage.service:18-19`              | `StartLimitIntervalSec`/`Burst` sit inside `[Service]` (line 8) — systemd ignores them, so the guard its own comment promises is inert.                                           |
| `packages/kanata/.../kanata.service:7-8`                           | `Restart=on-failure` + `RestartSec=3`, no start limit; `/usr/bin/kanata` does not exist on Void and the package has no `meta.json` to scope it.                                   |
| `sv/agentmemory/`, `sv/awsvpnclient/`, `sv/zramen/`                | No `log/run`. Only `sv/earlyoom/` has both `log/run` and `exec 2>&1`. `awsvpnclient/run` is 2 lines: no preflight, no backoff, target under `/opt`.                               |
| `.gitignore:2` (`.cursor/`, unanchored)                            | Shadows the entire `packages/cursor` payload — 6 files on disk, 0 tracked.                                                                                                        |
| `justfile:36,54`                                                   | `packages/zellij/config.kdl` does not exist; the real file is `packages/zellij/home/.config/zellij/config.kdl`, so the only `.kdl` is never checked.                              |
| `src/commands/pkg.ts:156`                                          | `collectFiles(pkgDir, "system")` with no `init`, so init-only packages report zero files and are excluded from `dot pkg --all`. `packages/usage` is unreachable that way on Void. |
| `packages/oom/.../10-args.conf:79`                                 | `-S 6291456,3145728` predates the 16 GiB swapfile; free swap rarely drops that low, so the swap brake is effectively unreachable.                                                 |
| `AGENTS.md`                                                        | Says `just fmt`; the recipe is `just format`.                                                                                                                                     |
| `packages/udev/`, `packages/snapper-config/`                       | Files at package root, no `home/`/`system/`/`etc-real/` — nothing links or installs them. The udev rule is early-boot anyway, so it could only ever live in `etc-real/`.          |
| `packages/atuin/config.toml`                                       | Package-root duplicate of the linked copy, already drifted.                                                                                                                       |
| `packages/agentmemory/home/.agentmemory/.env`                      | Tracked, with commented placeholder keys. Deleting one `#` commits a live credential, and `.gitignore` has no `.env`/`.npmrc`/`secrets` rule.                                     |

## 10. Do not raise

- TypeScript or Lua **style**: quotes, semicolons, import order. There is no TS formatter and
  `stylua` owns Lua (including `sort_requires`, which _will_ reorder requires — flag only a
  load-order-dependent require, never the ordering itself).
- Missing tests for `src/commands/**`. No harness exists there; ask for a test only when the
  change is in `src/lib/`, which has one.
- Commands from `docs/system-hygiene.md` or `docs/nvidia.md` on the Void boot — both are
  Arch-only and prescribe `paccache`/`systemctl`/`mkinitcpio`, which do not exist there (this
  host uses dracut). Citing a stale doc is worse than no advice.
- Package payload **content** (a keybinding, a colour, a plugin list). Not your call unless it
  is boot-critical or a credential.
- One note per update, and only with a concrete reason. "Looks risky" is not a note.
