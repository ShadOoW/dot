# zram — compressed RAM swap (Arch/systemd + Void/runit)

```sh
dot pkg zram configure               # installs real files into /etc, both inits
dot pkg zram enable --init runit     # Void only: symlink /etc/sv/zramen -> /var/service
```

`configure.sh` auto-detects the init from **`/run/systemd/system`** vs `/etc/sv`. Not
`/run/systemd` — elogind creates that on Void for the logind API, so the bare check reported
systemd on Void, installed the wrong tree, skipped `/etc/sv/zramen/conf` entirely and then
died on `systemctl: command not found`. Void consequently ran on zramen's built-in defaults
(lz4, priority 32767, no size ceiling) while looking configured. Read the script header before
changing anything — these files **must be real files in `/etc`, never linked by dot**, because
they are consumed before `/data` is mounted.

## Layout

| Tree                | Init     | Contents                                                       |
| ------------------- | -------- | -------------------------------------------------------------- |
| `etc-real/`         | **both** | `etc/sysctl.d/30-reclaim.conf`, `etc/modules-load.d/zram.conf` |
| `etc-real-systemd/` | Arch     | `etc/systemd/zram-generator.conf`, `etc/tmpfiles.d/zswap.conf` |
| `etc-real-runit/`   | Void     | `etc/sv/zramen/conf`                                           |

`configure.sh` also writes `N` to `/sys/module/zswap/parameters/enabled` on **both** inits —
the tmpfiles.d declaration is only the systemd-side persistence of the same thing.

## The two implementations, kept equivalent

|             | Arch (`zram-generator`)        | Void (`zramen`)               |
| ----------- | ------------------------------ | ----------------------------- |
| size        | `zram-size = ram * 0.25`       | `ZRAM_SIZE=25`                |
| ceiling     | n/a (percentage only)          | `ZRAM_MAX_SIZE=8192`          |
| algorithm   | `zstd`                         | `ZRAM_COMP_ALGORITHM=zstd`    |
| priority    | `swap-priority = 100`          | `ZRAM_PRIORITY=100`           |
| zram module | `etc/modules-load.d/zram.conf` | zramen `modprobe`s it itself  |
| watermarks  | `etc/sysctl.d/30-reclaim.conf` | same file, via `08-sysctl.sh` |

Both sit above the NVMe swapfile (`/mnt/engine/swapfile … pri=10`, see `packages/swap`),
which is the only thing that adds real capacity.

Everything on the Void side is pinned even where it matches a zramen default. `ZRAM_SIZE=25`
_is_ the default — pinning it stops a package update silently changing a value that hard-
locked this machine at 75%. And `ZRAM_MAX_SIZE` unset means **no cap at all**, not the 4096
that the stock commented conf implies: zramen only applies a ceiling when one is set
explicitly (`/usr/bin/zramen` line 218).

## Sizing is load-bearing — do not raise it

`ram * 0.75` froze the Arch side once or twice a day between 2026-07-28 and 2026-08-01. Not
an OOM — a reclaim livelock, because storing a compressed page requires allocating a page.
Full kernel evidence in **`docs/zram.md`, "The 0.75 freeze"**.

## zswap must stay off

zram and zswap are both compressed-anon-page caches. Stacked, a page is compressed by zswap
into a RAM pool and then compressed **again** by zram on writeback. linux-zen ships
`CONFIG_ZSWAP_DEFAULT_ON=y`, so this was silently the case here until 2026-08-05.

Beyond the wasted CPU and up-to-6.4 GiB pool, zswap writeback allocates in order to free, in
the reclaim path — the same hazard that made `ram * 0.75` deadly, one layer higher. Full
write-up in **`docs/zram.md`, "zswap was stacked in front of zram the whole time"**.

```sh
cat /sys/module/zswap/parameters/enabled   # want N
```

The kernel cmdline (`zswap.enabled=0`, see `docs/grub.md`) is authoritative; the tmpfiles.d
entry here is the repo-managed backstop, because GRUB is not managed by this repo.

The complete fix is three legs, and shrinking the device is only one of them:

| leg                                                           | where                                   | Arch | Void |
| ------------------------------------------------------------- | --------------------------------------- | ---- | ---- |
| device 0.75 → 0.25                                            | this package                            | yes  | yes  |
| `min_free_kbytes` 64→512 MiB, `watermark_scale_factor` 10→200 | `etc-real/etc/sysctl.d/30-reclaim.conf` | yes  | yes  |
| `earlyoom` thresholds                                         | `packages/oom`                          | yes  | yes  |

All three legs now land on both inits. `packages/oom` grew a runit half — `/etc/sv/earlyoom`
plus a `--avoid` list written against Void's own process names — so Void is no longer relying
on the first two legs alone. What Void still does not get is the cgroup memory floor
(`system.slice MemoryMin=1G`), because runit does not put services in cgroups; there,
earlyoom's `--avoid` list is the only thing protecting the session and the supervision tree.
See `packages/oom/README.md`, "Void / runit".

## Verify — after a _fresh boot_, not after a daemon-reload

A reload masks the `/data`-not-mounted bug. Only a clean boot proves it.

```sh
swapon --show                  # zram device present, ~7.8G, PRIO above the swapfile's 10
zramctl                        # algorithm must read zstd
sysctl vm.min_free_kbytes vm.watermark_scale_factor    # 524288 / 200
journalctl -b | grep -Ei 'zram|failed to chase'        # no "No configuration found"
```

On Void, `sv status zramen` instead of the journal check.
