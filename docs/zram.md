# zram Setup

zram creates a compressed RAM-backed swap device, reducing disk I/O and improving
responsiveness on systems with limited memory.

> **zram swap is _not_ extra capacity.** It is RAM compressed in RAM (~2-3:1 with zstd), so it
> buys headroom, not a second tier. A workload that genuinely wants more than physical RAM
> still gets OOM-killed — as happened on 2026-07-28, with a 23 GiB zram device fully engaged.
> A disk-backed swapfile is the only thing that adds real capacity.

## Package

```
xbps-install zram-generator   # Void Linux
pacman -S zram-generator       # Arch Linux
```

## Configuration

Current settings (`packages/zram/etc-real/etc/systemd/zram-generator.conf`):

```ini
[zram0]
zram-size = ram * 0.75          # 31 GiB host -> ~23 GiB device
compression-algorithm = zstd
swap-priority = 100
fs-type = swap
```

## ⚠️ These two files must be REAL FILES in /etc — never `dot link`ed

```
/etc/systemd/zram-generator.conf
/etc/modules-load.d/zram.conf
```

They live under **`etc-real/`** rather than `system/` on purpose: dot's linker only walks
`home/` and `system/` (`collectFiles` in `src/lib/pkg.ts`), so `dot link zram` **physically
cannot** recreate the symlink. `configure.sh` installs real copies instead.

`dot link` creates symlinks into `/data/config/dot/`, and `/data` is a btrfs-pool subvolume
that **is not mounted yet** when zram is set up:

- `zram-generator` is a _systemd generator_ — it runs before any unit, earliest in boot.
- `systemd-modules-load` runs at sysinit, ~1 s before `data.mount`.

A symlink there resolves to nothing, and neither consumer errors usefully — you just get no
swap, silently:

```
zram_generator::config[468]: No configuration found.
systemd-modules-load[490]: Failed to chase '/etc/modules-load.d/zram.conf': No such file
```

This caused a **9-day silent swap outage** (2026-07-19 → 07-28). It masqueraded as working
because a generator re-runs on `systemctl daemon-reload`, by which point `/data` _is_ mounted
— so swap would appear an hour or two into a boot, from some unrelated reload, and look fine.

Keep the dot copy as the reference, install real files into `/etc`, and change both together.
See the "Early boot" section of `/data/ops/CLAUDE.md` for the general rule and the audit
command.

## Enable

```sh
dot pkg zram configure     # installs the real files, reloads, activates zram0
```

Never install these by hand — `configure.sh` is the single place that knows they must be
real files, and it is idempotent. `enable-systemd.sh` just calls it.

## Verify — do this after a _fresh boot_, not after a daemon-reload

A reload hides the bug. Only a clean boot proves it.

```sh
swapon --show      # must list /dev/zram0
zramctl            # device, algorithm, and compression ratio
journalctl -b | grep -Ei 'zram|failed to chase'   # no "No configuration found"
```

If `swapon --show` is empty on a fresh boot but populated after `daemon-reload`, the symlink
regression is back.
