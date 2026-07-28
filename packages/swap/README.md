# swap — disk-backed swapfile on the XFS engine partition

Real swap capacity behind zram. `dot pkg swap configure`.

|          |                                                            |
| -------- | ---------------------------------------------------------- |
| File     | `/mnt/engine/swapfile` (XFS, `nvme0n1p9`)                  |
| Size     | 16 GiB                                                     |
| Priority | `10` — below zram's `100`, so compressed RAM is used first |

## Why, when zram already exists

zram is **RAM compressed in RAM** (~2-3:1 with zstd). It buys headroom, not a second tier.
A workload that genuinely wants more than physical RAM still gets OOM-killed — on
2026-07-28 the kernel OOM-killed this box _with_ 23 GiB of zram fully engaged (13.3 GiB
resident + 13.5 GiB swapped, 26.8 GiB total on a 31 GiB machine). Only a disk-backed file
adds capacity.

Ordering by priority is the point: `zram pri=100` fills first (fast, no I/O), and the
kernel only spills to NVMe under real pressure.

## Why `dd` and not `fallocate`

`fallocate` leaves unwritten extents on XFS and `swapon` refuses a file containing them
(`swapon: swapfile has holes`). `dd` writes real blocks. Slower to create, works.

Permissions are load-bearing too: `swapon` refuses anything world-readable, hence
`chmod 600` + `root:root`.

## Dual boot — Void needs a manual fstab line

Void mounts `/mnt/engine` at the **same path**, so one file serves both OSes (never
simultaneously — they don't run at once). But Void has its own fstab. Add to
`/mnt/void/etc/fstab`:

```
/mnt/engine/swapfile  none  swap  defaults,pri=10  0 0
```

Void's runit `core-services` run `swapon -a`, so that line is all it needs.

**Do not run `mkswap` again from Void** — the file is already formatted; re-running only
churns the UUID.

zram is handled differently on the two hosts: Arch uses `zram-generator` (systemd), Void
uses `zramen`. So `packages/zram` is Arch-only by design, while this swapfile is shared.

## Verify

```sh
swapon --show        # expect /dev/zram0 pri=100 AND /mnt/engine/swapfile pri=10
```

## Related

`packages/zram` (compressed tier + the early-boot symlink hazard), `packages/oom`
(earlyoom + reserving memory for the system + OOM notifications).
