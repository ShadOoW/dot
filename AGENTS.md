# dot — Agent Context

Stow-style dotfiles manager. `dot link <pkg>` walks `packages/<pkg>/` and creates
**symlinks** — `home/…` → `$HOME/…`, `system/{base,systemd,runit}/…` → `/…`
(see `src/lib/pkg.ts` for the path mapping, `src/commands/link.ts` for the linking).

This repo lives at **`/data/config/dot`**. Related: `/data/ops` (services; its `CLAUDE.md` is
the authoritative host-conventions file) and `/data/config/network` (router).

---

## The one hazard that has actually bitten: `/data` is not mounted at early boot

`dot link` only ever makes symlinks, and this repo is on the btrfs pool. Anything under
`/data` is **unavailable** until `local-fs.target`. Measured boot ordering:

```
17:56:48  systemd-modules-load.service      ← /etc/modules-load.d/*
17:56:48  systemd-vconsole-setup.service    ← /etc/vconsole.conf
17:56:49  data.mount                        ← /data appears, 1s too late
17:56:50  local-fs.target
```

systemd **generators** run earlier still, before any unit at all.

A symlink read in that window resolves to nothing, and the consumers do not fail loudly —
they treat the config as _absent_ and continue:

```
zram_generator::config[468]: No configuration found.
systemd-modules-load[490]: Failed to chase '/etc/modules-load.d/zram.conf': No such file
```

Cost so far: a **9-day silent swap outage** (zram never came up at boot; it only appeared when
something later ran `systemctl daemon-reload`, which re-runs generators after the mount — so
it looked like it worked), and `FONT=ter-v16` from `vconsole.conf` never being applied.

**Rule:** if systemd or the kernel reads it before `local-fs.target`, it is a **real file** in
`/etc` — not a `dot link`.

The convention that enforces this: such files live in a package's **`etc-real/`** directory,
which mirrors `/` (`etc-real/etc/foo.conf` → `/etc/foo.conf`), and the package's
`configure.sh` installs real copies from it. Because `collectFiles` only walks `home/` and
`system/`, anything under `etc-real/` is **structurally impossible to symlink** — `dot link`
cannot reintroduce the bug even by accident. The dot copy is the reference, `/etc` is
authoritative, change both together.

When installing, `rm -f` the destination **before** writing: `install`/`cp` onto a symlink
path follows the link and would clobber the file inside `/data/config/dot` instead of
replacing the link.

Current `etc-real/` users:

| Package | File                               | Consumer                         |
| ------- | ---------------------------------- | -------------------------------- |
| `zram`  | `/etc/systemd/zram-generator.conf` | generator (earliest)             |
| `zram`  | `/etc/modules-load.d/zram.conf`    | systemd-modules-load             |
| `fonts` | `/etc/vconsole.conf`               | systemd-vconsole-setup           |
| `oom`   | `/etc/systemd/system/*.d/*.conf`   | unit drop-ins, read at unit load |

Note the last one: **systemd unit drop-ins under `/etc/systemd/system` count as early-boot**
too — systemd loads units before `/data` is mounted.

Read after `local-fs.target`, so safe to link: `/etc/nix/nix.conf`, `/etc/environment`,
`/etc/systemd/user/*.service` (the user manager starts post-mount), `/etc/ly/*`.

Audit whenever a `system/` path is added:

```sh
find /etc -maxdepth 4 -type l -exec sh -c \
  'for l; do case "$(readlink "$l")" in /data/*) echo "$l";; esac; done' _ {} +
journalctl -b | grep -Ei 'failed to chase|no configuration found'   # must be empty
```

**Verify on a fresh boot, never after a `daemon-reload`** — a reload masks exactly this class
of bug. See `docs/zram.md`.

---

## Units this repo ships

`system/{systemd,runit}/…` unit files are picked up per-init (`src/lib/pkg.ts:184-186`), plus
distro units merely enabled via `meta.json` `services` (`src/lib/service.ts`).

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

## Memory safety lives in three packages

Split by tier, not by accident — read the READMEs before changing thresholds:

- **`zram`** — compressed RAM swap (`pri=100`). Not extra capacity; RAM compressed in RAM.
- **`swap`** — 16 GiB NVMe swapfile on `/mnt/engine` (`pri=10`). The only real capacity.
  Shared with Void, which needs its own fstab line.
- **`oom`** — `earlyoom` (process-granular; systemd-oomd is unusable here because sway puts
  every app in one `session-c1.scope` cgroup), `MemoryMin` floors, and a critical OOM
  notification. Styling for that notification is in **`mako`**, the live notification daemon.

## `dot sgc` — memory diagnosis and reclaim

Was `~/.local/bin/sgc` (standalone bash, now deleted). `src/commands/sgc.ts` +
`src/lib/memory.ts`.

- `dot sgc report` — memory ranked by process family, plus insights worth acting on
- `dot sgc clean` — reap stopped trees, orphaned helpers, oversized language servers
- `dot sgc mpv` — restart the leaking wallpaper

Two things to preserve if you touch it:

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
- `packages/<pkg>/meta.json` declares per-distro deps, tags, `cleanSteps`. Packages are
  discovered by directory scan (`PACKAGES_DIR` in `src/lib/config.ts`) — there is no central
  registry to update when adding or removing one.
- `just fmt` / `just check` before committing (`ruff` over `packages/`, `kdlfmt` for zellij).
