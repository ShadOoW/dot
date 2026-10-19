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
> **`/data/code/logos/apps/dot`** (entry `apps/dot/dot.ts`); this repo has no TS of its own.

## 1. The hook and the home directory

No package ships an `etc-real*` tree since dot 02. On the desk `/etc` is store-owned: NixOS
generates the configuration from the flake and installs it as a store symlink, so a payload
file under `system/` aimed at `/etc` is either ignored or in conflict. On the Mac, launchd
reads `~/Library/LaunchAgents` after `$HOME` is mounted, so a payload link there is safe.

| Signature in a diff                                                                                                                                                                                          | Verdict                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| New or moved path under `packages/*/system/**` whose target is `/etc/modules-load.d/`, `/etc/sysctl.d/`, `/etc/tmpfiles.d/`, `/etc/udev/rules.d/`, `/etc/vconsole.conf`, `/etc/systemd/**`, `/etc/sv/*/conf` | blocker                |
| A file moved _out of_ `etc-real*/` into `system/`                                                                                                                                                            | blocker, by definition |
| The literal `etc-real` appearing anywhere in `src/**`                                                                                                                                                        | blocker — see §5       |
| `dot doctor --fix --force` proposed near one of these paths: a real file at the target is classified `drift` and replaced with a symlink                                                                     | blocker                |

Match `etc-real*`, not `etc-real`: the linker still accepts `etc-real/`,
`etc-real-systemd/` and `etc-real-runit/` as names. A diff adding an `etc-real*` file is a
blocker on both hosts, and it adds the file to `AGENTS.md`'s hazard section in the same
commit.

**Proof standard.** These are verified **only on a fresh boot or login**. `systemctl
daemon-reload` re-runs generators _after_ the mount and `sv restart` re-reads config _after_
the FS is up — both mask exactly this class. Separately, `systemctl enable --now` on an
already-running unit does not pick up a changed `ExecStart`; demand `restart`. If a diff's
stated verification is a reload, that is not verification: say so.

## 2. Shipped units

The repo has already paid for each of these once.

- **Interpreter path in a version-managed dir.** `ExecStart=`/`exec`/shebang matching
  `managed-fnm`, `/.cache/`, `/.nvm/`, `/.asdf/`, `/.pyenv/`, `node_modules/.bin`,
  `/.local/share/mise`, `$HOME/.bun/bin`, or `env node|bun|python`. The alias moves, the unit
  hot-loops on `status=203/EXEC`. blocker.
- **`Restart=` without a start limit.** `Restart=on-failure|always` needs
  `StartLimitIntervalSec=` **and** `StartLimitBurst=`, and both belong in **`[Unit]`** —
  systemd silently ignores them in `[Service]`. A small `RestartSec` never trips the default
  5-in-10s limit, so a broken path becomes an indefinite loop instead of a failed unit.
  Correct example: `polkit-agent.service:5-6`. concern, blocker if the exec path is also
  unstable.
- **launchd needs an absolute program and a bounded loop.** `ProgramArguments` must be an
  absolute path (launchd has no `PATH` search), and `KeepAlive=true` on a program that exits
  immediately is the launchd shape of the restart loop — pair it with `RunAtLoad` and a
  program that runs until it is told to stop. concern, blocker if the path is unstable.

## 3. Real-file installers (`configure.sh`)

`install`/`cp` onto a symlink path **follows the link** and clobbers the file inside
`/data/config/dot`. Every write into `/etc` must be `rm -f "$dst"` first, then install, and
ideally a `[ -L "$dst" ]` bail. `fonts/configure.sh` is the one configure script that no
longer writes there — it runs `fc-cache -fv` and nothing else — and `secrets/configure.sh`
shows the same real-file discipline for `$HOME` (mode 700, files 600, never a link). blocker
when the package also ships a `system/` path to the same destination.

## 4. Memory tiers are the host's

The desk has no swap; punk owns the host's memory policy — earlyoom, zswap and the disk
swap (`/data/code/logos/fleet/machines/punk/memory.nix`, `storage/disk.nix`). A payload diff
adding zram, swap or earlyoom configuration is a blocker; so is one that moves a threshold
out of punk's declaration and into a package.

## 5. `src/` invariants that nothing but convention enforces

- **`etc-real*` is unreachable by design, not by check.** `collectFiles` walks only
  `join(pkgDir, section)` for `section: "home" | "system"` (`src/lib/pkg.ts:170-173`), and the
  string `etc-real` appears nowhere in `src/`. Widening that union, walking `pkgDir` itself, or
  adding an `etc-real` branch to `resolveTarget` re-arms the outage. blocker. The hazard and
  its incident are in `AGENTS.md`, section "The early-boot hazard".
- **`resolveTarget` has a catch-all.** `system/<x>/…` for any `<x>` outside
  `base|systemd|launchd` maps to `/<x>/…` (`src/lib/pkg.ts:199-207`), and the init filter
  (`:184-186`) skips only those three exact strings. So `system/systmd/etc/foo.conf` links to
  `/systmd/etc/foo.conf` on every host, silently. Nothing in the payload uses the fallthrough
  now that `ly` is gone: the second segment under `system/` must be exactly
  `base|systemd|launchd`, and a new `runit` tree is a blocker even though the linker still
  accepts the name. Adding a new init requires coordinated edits in `collectFiles`,
  `resolveTarget`, `hasInitDirs`, `collectEnableScripts`, `declaredServices` and
  `findSystemGhosts`; a partial set is a bug.
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
- The parked distro verbs are unreachable on both hosts; do not extend them.

## 7. Distro divergence belongs in a table, not an `if`

`run()` is `Bun.spawn` and **throws** on a missing binary rather than returning 127, so one
unguarded `pacman` call kills the rest of the command. And a package-manager-shaped
assumption on NixOS produces a confident _false pass_: `nixos` carries no package manager,
`linux` matches it, and `arch`/`void` are valid only for the parked code. Flag: new
`pacman|paccache|yay|vkpurge|xbps-*` literals in `apps/dot/src/**` outside `sweep.ts`'s
`SYSTEMS` table or without a `commandExists()` probe; any `if (distro === …)` in a command
that has a table; any distro branch whose non-matching side emits _success_.

`appliesToCurrentOS` collapses everything non-macOS to `linux`, so **`os: ["linux"]` does not
exclude a host**. `meta.json` unknown keys are warn-only and silently dropped, so `"service"`
for `"services"` no-ops. Packages that ship no `meta.json` claim to apply everywhere, macOS
included.

## 8. Gate blind spots — absorb these yourself

`just check` (the recipe is `check`; **`just fmt` does not exist**, it is `format`) runs
stylua/shfmt/ruff-format/prettier/kdlfmt/taplo; the CLI's `tsc --noEmit` and `bun test`
gates moved with it to `/data/code/logos/apps/dot`. What it does **not** catch, and you
therefore must:

- **No linter of any language.** `ruff.toml` is format-only; no shellcheck, no eslint. Unquoted
  expansions, `set -euo pipefail` omissions, undefined Python names all pass.
- **The TS CLI (`/data/code/logos/apps/dot`) has no formatter and no lint**, and its `tsconfig`
  lacks `noUncheckedIndexedAccess` — direct risk in the code parsing `/proc/*/smaps_rollup`.
- **CLI tests exist only under `apps/dot/src/lib/` (9 files).** `apps/dot/src/commands/link.ts` —
  the symlink engine — has none, nor do `sgc`/`doctor`/`sweep`/`kernel`.
- **`packages/` is never type-checked** — no TS remains in this repo.
- **`.zsh` is covered by neither the formatter nor any test.**
- **Nothing verifies that a file dot's linker would install is tracked by git.** `.gitignore`
  uses unanchored directory patterns, so a package payload can be invisible while every gate
  is green. Any new `.gitignore` line without a leading `/`, and any package path containing a
  segment `backup`, `node_modules`, `.cursor`, or `__pycache__`, deserves a note.
- `taplo check` is schema validation, not a format check; unformatted TOML passes and then
  churns on the next `just format`.

## 9. Pre-existing defects — do not re-report as new

Raise these **only** if the change touches them or makes them worse. Do repeat them if a diff
walks past one while editing the same file.

| Location                                                           | Defect                                                                                                                                               |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/agentmemory/system/systemd/.../agentmemory.service:8-10` | Still `ExecStart=%h/.cache/managed-fnm/…`, `Restart=on-failure`, no start limit — the incident AGENTS.md describes in past tense.                    |
| `.gitignore:2` (`.cursor/`, unanchored)                            | Shadows the entire `packages/cursor` payload — 6 files on disk, 0 tracked.                                                                           |
| `justfile:36,54`                                                   | `packages/zellij/config.kdl` does not exist; the real file is `packages/zellij/home/.config/zellij/config.kdl`, so the only `.kdl` is never checked. |
| `src/commands/pkg.ts:156`                                          | `collectFiles(pkgDir, "system")` with no `init`, so init-only packages report zero files and are excluded from `dot pkg --all`.                      |
| `packages/atuin/config.toml`                                       | Package-root duplicate of the linked copy, already drifted.                                                                                          |
| `packages/agentmemory/home/.agentmemory/.env`                      | Tracked, with commented placeholder keys. Deleting one `#` commits a live credential, and `.gitignore` has no `.env`/`.npmrc`/`secrets` rule.        |

## 10. Do not raise

- TypeScript or Lua **style**: quotes, semicolons, import order. There is no TS formatter and
  `stylua` owns Lua (including `sort_requires`, which _will_ reorder requires — flag only a
  load-order-dependent require, never the ordering itself).
- Missing tests for `src/commands/**`. No harness exists there; ask for a test only when the
  change is in `src/lib/`, which has one.
- Advice from a deleted document: `docs/` holds only `session.md` after dot 02, so a command
  quoted from anything else is stale by definition.
- Package payload **content** (a keybinding, a colour, a plugin list). Not your call unless it
  is boot-critical or a credential.
- One note per update, and only with a concrete reason. "Looks risky" is not a note.
