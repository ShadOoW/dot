# dot — Agent Context

Stow-style dotfiles manager. `dot link <pkg>` walks `packages/<pkg>/` and creates
**symlinks** — `home/…` → `$HOME/…`, `system/{base,systemd,runit}/…` → `/…`
(`src/lib/pkg.ts` maps the paths, `src/commands/link.ts` links). The CLI itself lives at
**`/data/code/fleet/apps/dot`** since commit 02c065c — every `src/…` path below is relative
to that, not to this repo.

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

## This file is Arch-centric — where it does _not_ apply on the Void boot

This machine dual-boots. Everything above about early boot is a **systemd** property, and
the two inits diverge in opposite directions. Audited 2026-08-08; see
`docs/system-analysis.md`.

**The `etc-real/` rule does not constrain service definitions under runit.**
`/etc/runit/core-services/03-filesystems.sh` mounts fstab _before_ stage 2 execs
`runsvdir`, so `/data` is present when the service dir is scanned — proven by all 26
`/data/ops` services showing Δboot = 0. 26 of 43 `/var/service` symlinks point into
`/data/ops` and that is safe. The rule stays fully in force for the Arch boot, where
generators genuinely run before `data.mount`.

**The interpreter-path hazard is worse under runit, not better.** `/etc/runit/2` runs
`exec env - PATH=$PATH runsvdir`, scrubbing the environment for every `run` script. There
is also no `StartLimitBurst` to fall back on, so the backoff must live in the script:
print one line, `sleep 30`, `exit 1`. See `packages/agentmemory/.../sv/agentmemory/run`
and `packages/usage/.../sv/dot-usage/run`.

**runit discards stderr, and has no journal.** `runsv` wires only _stdout_ to the svlogd
pipe. A service with no `exec 2>&1` and a Go-style stderr logger produces a **0-byte**
`current` while running perfectly — 12 of 30 log dirs on this host. Worse, seven native
services (`sshd`, `dbus`, `dhcpcd`, `elogind`, `iwd`, `nix-daemon`, `udevd`) pipe
`log/run` into `vlogger`, which writes to `/dev/log`; no syslog daemon runs and the socket
does not exist, so **sshd's auth log goes nowhere**. Under systemd both streams land in
the journal for free, which is why this is invisible until you switch inits. Any unit this
repo ships for runit needs its own `log/run`.

**Diagnosing runit unprivileged.** `sv status` always fails as a normal user
(`/run/runit/supervise.*` is 0700 root) — that is what once made `dot doctor` report every
service as "not enabled". Compare each `runsv` child's `etimes` against its sibling
`svlogd`'s instead: svlogd is started once and never restarted, so
**`svlogd_etimes ≫ child_etimes` is a precise crash-and-restart signature.**

**Timestamps.** svlogd stamps UTC (`-tt`); the host is `+01:00`. Add an hour to every
`/var/log/runit/*` line before correlating with `ps`. Derive boot from `/proc/stat btime`.

**Tooling parity.** `dot doctor`, `cache`, `update`, `kernel` and `sweep` are all
distro-guarded. `docs/system-hygiene.md` and `docs/nvidia.md` are still Arch-only and
prescribe commands (`paccache`, `systemctl`, `mkinitcpio`) that do not exist here — this
host uses **dracut**. Void's unmerged-config marker is `<file>.new-<version>`, never
`.pacnew`; searching for the wrong one yields a confident false all-clear.

---

## Units this repo ships

`system/{systemd,runit}/…` unit files are picked up per-init (`collectFiles` in
`src/lib/pkg.ts`), plus distro units merely enabled via `meta.json` `services`
(`src/lib/service.ts`).

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

## `dot sgc` & `dot sweep` — system hygiene

Was `~/.local/bin/sgc` (standalone bash, now deleted). `src/commands/sgc.ts` +
`src/lib/memory.ts`.

- `dot sgc report` — memory ranked by process family, plus insights worth acting on
- `dot sgc clean` — reap stopped trees, orphaned helpers, oversized language servers
- `dot sgc mpv` — restart the leaking wallpaper

We also proactively fight disk bloat using `dot sweep`. See **`docs/system-hygiene.md`** for the full philosophy on preventing Arch from degrading over time.

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
- `packages/<pkg>/meta.json` declares per-distro deps, tags, `cleanSteps`. Packages are
  discovered by directory scan (`PACKAGES_DIR` in `src/lib/config.ts`) — there is no central
  registry to update when adding or removing one.
- `just format` / `just check` before committing (`ruff` over `packages/`, `kdlfmt` for zellij).
