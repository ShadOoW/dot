# zram — compressed RAM swap (Arch/systemd + Void/runit)

```sh
dot pkg zram configure               # installs real files into /etc, both inits
dot pkg zram enable --init runit     # Void only: symlink /etc/sv/zramen -> /var/service
```

`configure.sh` auto-detects the init from `/run/systemd` vs `/etc/sv`. Read its header
before changing anything — these files **must be real files in `/etc`, never `dot link`ed**,
because they are consumed before `/data` is mounted.

## Layout

| Tree                | Init     | Contents                                                          |
| ------------------- | -------- | ----------------------------------------------------------------- |
| `etc-real/`         | **both** | `etc/sysctl.d/30-reclaim.conf`                                    |
| `etc-real-systemd/` | Arch     | `etc/systemd/zram-generator.conf`, `etc/modules-load.d/zram.conf` |
| `etc-real-runit/`   | Void     | `etc/sv/zramen/conf`                                              |

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

The complete fix is three legs, and shrinking the device is only one of them:

| leg                                                           | where                                   | Arch | Void   |
| ------------------------------------------------------------- | --------------------------------------- | ---- | ------ |
| device 0.75 → 0.25                                            | this package                            | yes  | yes    |
| `min_free_kbytes` 64→512 MiB, `watermark_scale_factor` 10→200 | `etc-real/etc/sysctl.d/30-reclaim.conf` | yes  | yes    |
| `earlyoom -s 100,100`                                         | `packages/oom`                          | yes  | **no** |

**Void has no earlyoom.** `packages/oom` is Arch/systemd-only by design (its drop-ins are
systemd unit config and its notifier is a systemd user service). Covering Void would mean an
`/etc/sv/earlyoom` runit service plus a different notifier hookup. Void therefore keeps the
first two legs — which address the livelock mechanism itself — but has no process-granular
killer for a genuine exhaustion event.

## Verify — after a _fresh boot_, not after a daemon-reload

A reload masks the `/data`-not-mounted bug. Only a clean boot proves it.

```sh
swapon --show                  # zram device present, ~7.8G, PRIO above the swapfile's 10
zramctl                        # algorithm must read zstd
sysctl vm.min_free_kbytes vm.watermark_scale_factor    # 524288 / 200
journalctl -b | grep -Ei 'zram|failed to chase'        # no "No configuration found"
```

On Void, `sv status zramen` instead of the journal check.
