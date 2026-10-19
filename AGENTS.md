# dot — Agent Context

Stow-style dotfiles manager. `dot pkg <pkg> link` walks `packages/<pkg>/` and creates
**symlinks** — `home/…` → `$HOME/…`, `system/{base,systemd,launchd}/…` → `/…` or
`~/Library/LaunchAgents/…` (`src/lib/pkg.ts` maps the paths, `src/commands/link.ts` links).
The CLI itself lives at **`/data/code/logos/apps/dot`** — every `src/…` path below is
relative to that, not to this repo.

This repo lives at **`/data/config/dot`**. Its two hosts are the NixOS desk (a container on
punk) and the macOS MacBook; the fleet flake in `/data/code/logos/fleet/` owns both system
layers.

---

## The early-boot hazard

On the Arch install a systemd generator read a symlink into `/data` before
`local-fs.target`. The link resolved to nothing, the generator logged "No configuration
found" and carried on: nine days of silent swap outage, until an unrelated `daemon-reload`
re-ran generators after the mount and made it look as though it had always worked.
`FONT=ter-v16` from `vconsole.conf` never applied in the same window.

**Rule:** if systemd or the kernel reads it before `local-fs.target`, it is a **real file**
in `/etc`, not a `dot` symlink. The desk's `/etc` is store-owned — NixOS generates the
configuration from the flake and symlinks it into `/etc/static` — and on the Mac launchd
reads `~/Library/LaunchAgents` after `$HOME` is mounted, so a link there is safe. No package
ships an `etc-real*` tree since dot 02.

The `etc-real*` convention remains in the linker: such files live in a package's
`etc-real*/` directory, which mirrors `/`, and the package's `configure.sh` installs real
copies. Because `collectFiles` only walks `home/` and `system/`, anything under `etc-real*`
is **structurally impossible to symlink**; `apps/dot/test/etc-real.test.ts` keeps that
property green.

### Writing into /etc: rm -f first

`install`/`cp` onto a symlink path follows the link and overwrites the file **inside this
repo**. Remove the destination first (`rm -f "$dst"`), then install the real file.

---

## Units this repo ships

`system/{systemd,launchd}/…` unit files are picked up per init (`collectFiles` in
`src/lib/pkg.ts`), plus units merely enabled via `meta.json` `services`
(`src/lib/service.ts`).

- `system/systemd` — `agentmemory`, sway's polkit agent and `tmux-server`. The desk does not
  link them: `/etc/systemd/user` is store-owned, and the flake declares what runs.
- `system/launchd` — `agentmemory` on the Mac.

Interpreter paths in a shipped unit are a liability: pin something stable, or exec via an
absolute path you control. `agentmemory.service` pointed `ExecStart` at
`~/.cache/managed-fnm/aliases/default/bin/<bin>`; when fnm's `default` alias moved to a new
node version the global package did not follow, and the unit restart-looped on
`status=203/EXEC` — ~590 restarts per boot, indefinitely, because `RestartSec=5` never trips
systemd's default start limit (5-in-10s).

When adding `Restart=on-failure` to a unit, give it a `StartLimitIntervalSec`/`StartLimitBurst`
that actually gives up, so a broken path is a _failed_ unit you notice rather than a silent
loop burning CPU. `litellm.service` cost 25 min of CPU and ~270 MB churn every 5 s this way
before it was removed.

---

## Memory safety is the host's

The desk is a container with no swap. Punk owns the host's memory policy — earlyoom, zswap
and the disk swap — in `/data/code/logos/fleet/machines/punk/memory.nix` and
`fleet/machines/punk/storage/disk.nix`. The payload ships no memory configuration since
dot 02.

## `dot sgc` — memory hygiene

Was `~/.local/bin/sgc` (standalone bash, now deleted). `src/commands/sgc.ts` +
`src/lib/memory.ts`.

- `dot sgc report` — memory ranked by process family, plus insights worth acting on
- `dot sgc clean` — reap stopped trees, orphaned helpers, oversized language servers
- `dot sgc mpv` — restart the leaking wallpaper

Two things to preserve if you touch sgc:

**Use PSS, never summed RSS.** RSS counts every shared page in full in every process that
maps it, so summing across a family double-counts shared node/chromium text. Measured here:
naive RSS sums to 24.0 GiB against a true 14.3 GiB. PSS divides shared pages by their mapper
count, which makes it additive. Read `/proc/PID/smaps_rollup` (~46 ms for all processes);
fall back to RSS only where unreadable, and mark those rows. Filter kernel threads — each has
a unique `comm`, so leaving them in produced ~400 bogus one-process "families".

**`report` and `clean` share one definition of reclaimable** (`findTargets`). The old sgc
reaped only processes that were stopped _or_ reparented to PID 1 **and** matched a fixed name
list, and by the time it was needed during a real OOM it reported "nothing to reap" — the
memory had moved into live, correctly-parented TypeScript servers. Rules are now about
process _shape and size_, not names, so they keep working as the toolchain changes.

## Conventions

- **Never commit secrets.** `~/.npmrc`, `~/.config/secrets/*` and similar stay out of packages.
  Credential _templates_ go in `packages/secrets/templates/`, never under a package's `home/`:
  `collectFiles` cannot reach `templates/`, so dot's linker cannot plant a template inside the live
  credential store. It did, for three of them — `~/.config/secrets` held `.minimax.example`,
  `.deepseek.example` and `.agent-web.example` as symlinks into this repo, and the only thing
  stopping the login loader from sourcing them was the leading dot. `packages/*/home/.config/secrets/`
  is gitignored so the shape cannot come back. See `packages/secrets/README.md`.
- `packages/<pkg>/meta.json` declares deps, tags, `cleanSteps`. `nixos` is a distro key with
  no package manager; the flake declares its packages. Packages are discovered by directory
  scan (`PACKAGES_DIR` in `src/lib/config.ts`) — there is no central registry to update when
  adding or removing one.
- `just format` / `just check` before committing (`ruff` over `packages/`, `kdlfmt` for zellij).
