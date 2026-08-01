# zram Setup

zram creates a compressed RAM-backed swap device, reducing disk I/O and improving
responsiveness on systems with limited memory.

> **zram swap is _not_ extra capacity.** It is RAM compressed in RAM (~2-3:1 with zstd), so it
> buys headroom, not a second tier. A workload that genuinely wants more than physical RAM
> still gets OOM-killed — as happened on 2026-07-28, with a 23 GiB zram device fully engaged.
> A disk-backed swapfile is the only thing that adds real capacity.
>
> **Worse: an oversized zram device is actively dangerous.** Because storing a compressed
> page requires allocating a page, zram can deadlock reclaim under pressure and freeze the
> machine outright, with no OOM kill and swap still showing mostly free. That is exactly
> what `ram * 0.75` did here — see "The 0.75 freeze" below. Size it small.

## Package

```
xbps-install zram-generator   # Void Linux
pacman -S zram-generator       # Arch Linux
```

## Configuration

Current settings (`packages/zram/etc-real-systemd/etc/systemd/zram-generator.conf`):

```ini
[zram0]
zram-size = ram * 0.25          # 31 GiB host -> ~7.8 GiB device
compression-algorithm = zstd
swap-priority = 100
fs-type = swap
```

`0.25`, not `0.75` — see the next section for why. The prio-10 NVMe swapfile behind it
(`packages/swap`) is what actually adds capacity.

## The 0.75 freeze (2026-07-28 → 08-01)

`zram-size = ram * 0.75` gave a 23.3 GiB device on a 31 GiB host, and that configuration
hard-locked the machine once or twice a day. Four consecutive boots ended with no shutdown
sequence in the journal at all — no `Reached target Shutdown`, no `systemd-shutdown`, the
log just stops mid-line:

| boot ended       | next boot        | gap    |
| ---------------- | ---------------- | ------ |
| 2026-07-28 17:50 | 2026-07-28 17:56 | 6 min  |
| 2026-07-29 20:09 | 2026-07-29 20:11 | 2 min  |
| 2026-07-31 14:05 | 2026-07-31 14:08 | 3 min  |
| 2026-07-31 23:43 | 2026-08-01 01:30 | 1h 47m |

**It is not an OOM. It is a reclaim livelock, and it is caused by zram itself.**

To swap a page out, zram must first _allocate_ a page (`zsmalloc`) to hold the compressed
copy. Once free memory is down at the watermark that allocation fails — so the swap-out
fails, so nothing is reclaimed, so `kswapd` never makes progress and every allocating task
stalls in direct reclaim. The kernel's own dumps, in order:

```
Jul 29 01:01:34  zsh: page allocation failure, order:0, mode:0xc0de0
                 Node 0 Normal free:14944kB  min:64308kB  zspages:2027248kB
Jul 29 01:01:39  Write-error on swap-device (252:0:15542040)     <- 252:0 is zram0
Jul 29 02:40:25  kswapd0: page allocation failure, order:0       <- reclaim itself starved
                 Node 0 Normal free:12692kB  min:64308kB  zspages:3829832kB
Jul 30 23:01:20  Node 0 Normal free:19540kB  min:64308kB  zspages:2815884kB
                 Free swap = 27990116kB                          <- 68% of swap FREE
```

Two things to read off that:

- `mode:0xc0de0` = `GFP_KERNEL|__GFP_HIGH|__GFP_ZERO|__GFP_COMP|__GFP_NOMEMALLOC`. That is
  the `zsmalloc` signature — the failing allocation _is_ zram trying to store a page.
- `zspages` climbing 2.0 → 2.8 → 3.8 GiB is zram consuming RAM to store RAM. The bigger the
  device, the higher that ceiling, and the harder the spiral bites.

And because ~27 GiB of swap still looked free, **nothing killed anything**: the kernel OOM
killer never ran, and earlyoom did not either — its `--help` states _"both memory and swap
must be below minimum for earlyoom to act"_, and swap was nowhere near its threshold. The
machine had no escape hatch and simply stopped.

### The fix is three-legged; zram sizing is only one leg

| leg                                             | where                                                                           | Void? |
| ----------------------------------------------- | ------------------------------------------------------------------------------- | ----- |
| `zram-size = ram * 0.25`                        | `packages/zram` — caps the zspages ceiling at ~3 GiB                            | yes   |
| `vm.min_free_kbytes` / `watermark_scale_factor` | `packages/zram/etc-real/etc/sysctl.d/30-reclaim.conf` — headroom for `zsmalloc` | yes   |
| `earlyoom -s 100,100`                           | `packages/oom` — defeats the swap AND-clause                                    | no    |

Shrinking zram alone is not sufficient: without the earlyoom and watermark changes a big
enough workload reaches the same dead end, just later. See `packages/oom/README.md`.

## Dual boot: Void gets the same treatment

Void runs `zramen` rather than `zram-generator`, so the same intent is expressed twice.
`packages/zram/etc-real-runit/etc/sv/zramen/conf` pins `ZRAM_SIZE=25`, `ZRAM_MAX_SIZE=8192`,
`zstd`, priority 100 — matching the Arch side field for field. The watermark sysctl is
shared: Void reads `/etc/sysctl.d/*.conf` from `/etc/runit/core-services/08-sysctl.sh`.

Two Void-specific traps, both handled in that conf:

- `ZRAM_MAX_SIZE` **unset means no ceiling at all**, not the `4096` the stock commented conf
  suggests — zramen only applies a cap when one is explicitly set (`/usr/bin/zramen:218`).
- Stock zramen defaults to **lz4** and priority **32767**, neither matching Arch.

`packages/zram/README.md` has the full side-by-side. Note Void has **no earlyoom** — see the
table above.

## ⚠️ These two files must be REAL FILES in /etc — never `dot link`ed

```
/etc/systemd/zram-generator.conf
/etc/modules-load.d/zram.conf
```

They live under **`etc-real-systemd/`** (and the shared sysctl under `etc-real/`, the Void
zramen conf under `etc-real-runit/`) rather than `system/` on purpose: dot's linker only
walks `home/` and `system/` (`collectFiles` in `src/lib/pkg.ts`), so `dot link zram`
**physically cannot** recreate the symlink. `configure.sh` installs real copies instead.

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
