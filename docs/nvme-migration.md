# NVMe Migration — SSD Sanitize & Repartition

## Status

| Phase                                                                    | Status                             |
| ------------------------------------------------------------------------ | ---------------------------------- |
| 0. System investigation & planning                                       | ✅ Done                            |
| 1a. Back up /boot and /boot/efi                                          | ✅ Done                            |
| 1b. Back up btrfs subvolumes (@arch, @arch-var, @void, @void-var, @home) | ✅ Done                            |
| 1c. Back up /data subdirs                                                | ✅ Done (partial — see gaps below) |
| 1d. Back up @nix (9.9 GB)                                                | ⬜ **Missing — do before wipe**    |
| 1e. Back up Steam userdata (100 MB)                                      | ⬜ **Missing — do before wipe**    |
| 1f. Save exact partition table (sgdisk)                                  | ⬜ **Missing — do before wipe**    |
| 2. Sanitize NVMe                                                         | ⬜ Pending                         |
| 3. Repartition with new layout                                           | ⬜ Pending                         |
| 4. Restore /boot and /boot/efi with original UUIDs                       | ⬜ Pending                         |
| 5. Create btrfs + XFS filesystems and restore subvolumes                 | ⬜ Pending                         |
| 6. Migrate @arch-var/@void-var content to XFS                            | ⬜ Pending                         |
| 7. Update fstab + /etc/grub.d/06_custom; regen initramfs + grub.cfg      | ⬜ Pending                         |
| 8. Boot test & validate health                                           | ⬜ Pending                         |

---

## Why We Are Doing This

The WD_BLACK SN770 2TB (`/dev/nvme0n1`) developed media errors after sustained thermal stress caused primarily by:

- Btrfs copy-on-write amplifying writes from Immich thumbnails, Docker layers, and `~/.cache`
- No swap / no NVMe RAM cache offload
- Long `Critical Composite Temperature Time` (404 minutes above threshold)

`nvme smart-log` snapshot (2026-06-26):

```
critical_warning                       : 0x4   ← namespace in read-only mode
temperature                            : 39°C  (idle temp)
Temperature Sensor 1                   : 59°C  (controller hotspot)
available_spare                        : 100%  ← spare sectors intact
percentage_used                        : 4%
media_errors                           : 63
num_err_log_entries                    : 63
Warning Temperature Time               : 173 min
Critical Composite Temperature Time   : 404 min
unsafe_shutdowns                       : 197
power_on_hours                         : 26 661 h
```

`critical_warning 0x4` (bit 2) means the firmware has placed the persistent memory region into read-only mode — the root cause of random hourly freezes. A block-erase sanitize resets this flag, and since `available_spare = 100%` the firmware can remap all bad LBAs to fresh spare sectors during the sanitize.

---

## Current Disk Layout (`/dev/nvme0n1`, 2 TB GPT)

From `lsblk -b` (2026-06-26):

```
Part   Size (bytes)      Size     FS      Label                  UUID
p1     1,073,741,824     1.0 GiB  vfat    —                      1A4A-CE0B           ← /boot/efi
p2        16,777,216    16.0 MiB  —       Microsoft reserved     —
p3   462,782,726,144   431.0 GiB  ntfs    —                      70C033CAC0339576    ← /mnt/windows
p4    33,335,279,616    31.0 GiB  —       (old, unused)          —                   ← DELETE
p7 1,475,063,389,696  1374.0 GiB  btrfs   linux-pool             e2671b81-6b31-4df2-bed9-63b3f4b3d48b
p8     8,125,415,424     7.6 GiB  ext4    boot                   fba989bd-2a90-4e11-9aa2-4c941d3e0460  ← /boot
p9    20,000,538,624    18.6 GiB  ext4    recovery               c3ea4d04-fe9a-47ff-ad23-a97de108817e
```

> Exact start/end sectors: run `sudo sgdisk --print /dev/nvme0n1` and paste output below before wiping.

```
PASTE SGDISK OUTPUT HERE
```

### External backup drive

```
/dev/sda1   ~466 GiB   btrfs   mounted at /mnt/external
406 GiB used, 59 GiB free
```

Note: the drive is **btrfs**, not exFAT. Backups were done as plain directory copies (rsync / cp), not btrfs send streams. Restore uses rsync into new subvolumes.

### Current btrfs subvolumes on p7

From `findmnt` (subvol IDs from `sudo btrfs subvolume list /mnt/pool` — paste below):

```
PASTE: sudo btrfs subvolume list /mnt/pool
```

Known mounts:

```
@arch             → /                        (Arch Linux root)
@arch-var         → /var
@arch-snapshots   → /.snapshots
@void             → /mnt/void               (Void Linux root)
@void-var         → (not in fstab, exists on pool)
@void-snapshots   → (exists on pool)
@home             → /home                   (16 GB backed up)
@home-cache       → /home/shad/.cache       (noatime — NOT backed up, cache only)
@data             → /data
@docker           → /var/lib/docker         (NOT backed up — images re-pullable)
@nix              → /nix                    (9.9 GB — NOT backed up yet)
```

### Current /data breakdown (2026-06-26)

```
/data/media       202 GB   (music 48G ✅, audiobook 12G ✅, games/steamapps 130G ✗ re-downloadable, Nichijou anime 11G ✗ NOT backed up)
/data/hdd         199 GB   ✅ fully backed up
/data/ops          74 GB   ✅ fully backed up
/data/code          7.3 GB  ✅ fully backed up
/data/stash         3.3 GB  ✅ fully backed up
/data/downloads   320 MB   ✅ fully backed up
/data/screens      47 MB   ✅ fully backed up
```

### Current boot chain

```
UEFI NVRAM
  Boot0001* GRUB → HD(p1,GPT,32fbc265-e96b-4414-ab4f-5bc57637f945)/\EFI\GRUB\grubx64.efi
  Boot0000* Windows Boot Manager → /EFI/Microsoft/Boot/bootmgfw.efi
  BootOrder: 0001 (GRUB), 0000 (Windows)

p1 (FAT32 /boot/efi)
  EFI/GRUB/grubx64.efi          ← GRUB EFI binary
  EFI/Microsoft/                ← Windows boot files
  EFI/Boot/bootx64.efi          ← fallback

p8 (ext4 /boot) — searched by UUID fba989bd-...
  vmlinuz-linux-zen              ← Arch (running: 7.0.12-zen1-1-zen)
  vmlinuz-linux                  ← Arch fallback
  vmlinuz-6.18.36_1, 6.18.34_1, 6.18.31_1  ← Void kernels
  vmlinuz-6.12.82_1              ← old Void kernel
  initramfs-*.img                ← matching initramfs for each kernel
  grub/grub.cfg                  ← generated; do not edit directly
  grub/themes/pika/              ← GRUB theme
  grub/grubenv                   ← saves last-used menu entry

p7 (btrfs @arch root — UUID e2671b81-...)
```

GRUB kernel cmdline (from `/etc/grub.d/06_custom`):

```
root=UUID=e2671b81-6b31-4df2-bed9-63b3f4b3d48b rootflags=subvol=/@arch rw quiet
  + loglevel=3 i915.enable_psr=0 i915.enable_fbc=0
  + nvidia-drm.modeset=1 nvidia.NVreg_PreserveVideoMemoryAllocations=0
```

mkinitcpio hooks (Arch):

```
MODULES=(nvidia nvidia_modeset nvidia_uvm nvidia_drm)
HOOKS=(base udev autodetect microcode modconf kms keyboard keymap consolefont block btrfs filesystems fsck)
```

---

## Backup State (as of 2026-06-26)

### What is on the external drive (`/mnt/external`)

| External path            | Source                         | Size    | Notes                                      |
| ------------------------ | ------------------------------ | ------- | ------------------------------------------ |
| `@arch_bak/`             | @arch                          | 29 GB   | ✅ complete                                |
| `@arch-var_bak/`         | @arch-var (→/var)              | 510 MB  | ✅ includes Lidarr/Prowlarr DBs, pacman db |
| `@home_bak/`             | @home                          | 16 GB   | ✅ includes Vivaldi history, dotfiles      |
| `@void_bak/`             | @void                          | 8.8 GB  | ✅ complete                                |
| `@void-var_bak/`         | @void-var                      | 325 MB  | ✅ complete                                |
| `boot/`                  | /boot (p8)                     | 1.4 GB  | ✅ all kernels + initramfs + grub/         |
| `efi/`                   | /boot/efi (p1)                 | 30 MB   | ✅ EFI/GRUB + EFI/Microsoft                |
| `hdd/`                   | /data/hdd                      | 199 GB  | ✅ complete                                |
| `ops/`                   | /data/ops                      | 74 GB   | ✅ complete                                |
| `stash/`                 | /data/stash                    | 3.3 GB  | ✅ complete                                |
| `code/`                  | /data/code                     | 7.3 GB  | ✅ complete                                |
| `media/music/`           | /data/media/music              | 48 GB   | ✅ complete                                |
| `media/audiobook/`       | /data/media/audiobook          | 12 GB   | ✅ complete                                |
| `media/games/mame/`      | /data/media/games/mame         | 1.8 GB  | ✅ complete                                |
| `media/books/`           | /data/media/books              | 191 MB  | ✅ complete                                |
| `downloads/`, `screens/` | /data/downloads, /data/screens | ~370 MB | ✅ complete                                |

### What is NOT backed up (gaps to fix before wipe)

| Missing              | Size   | Action                                                                                                                                                                                        |
| -------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **@nix**             | 9.9 GB | `sudo rsync -aHAX /nix/ /mnt/external/nix-bak/`                                                                                                                                               |
| **Steam userdata**   | 100 MB | `cp -a ~/.cache/managed-steam/Steam/userdata/ /mnt/external/steam-userdata/` — the `~/.local/share/Steam` symlink in `@home_bak` is dangling and resolves to the live system, not stored data |
| **Nichijou** (anime) | 11 GB  | `/data/media/anime/Nichijou/` — external has empty dir. Back up or accept loss.                                                                                                               |
| **games/steamapps**  | 130 GB | Re-downloadable from Steam. Explicitly not backed up by choice.                                                                                                                               |
| **Partition table**  | —      | `sudo sgdisk --backup=/mnt/external/nvme-gpt-backup.bin /dev/nvme0n1 && sudo sgdisk --print /dev/nvme0n1 > /mnt/external/nvme-partitions.txt`                                                 |

---

## Proposed New Partition Layout

Goals:

1. Isolate high-write, small-file workloads from btrfs CoW → **XFS partition**
2. Keep OS roots, home, and large data on btrfs for snapshots & compression
3. Use bind mounts so each OS sees `/var`, `~/.cache` at standard paths
4. Eliminate p4 dead space

```
Part     Size       FS      Mount / Purpose
p1       1.0 GiB   FAT32   /boot/efi                       KEEP — unchanged
p2       16 MiB    MSR     Windows reserved                KEEP — unchanged
p3       431 GiB   NTFS    /mnt/windows                    KEEP — unchanged
p8       7.6 GiB   ext4    /boot                           KEEP — same UUID restored
p9       18.6 GiB  ext4    Arch recovery                   KEEP — unchanged
p4       31 GiB    —       DELETE — merge into pool area
NEW-a   ~1100 GiB  btrfs   Main pool (roots, home, data, nix)
NEW-b    ~408 GiB  xfs     High-write shared partition
```

p4 + p7 combined free space: 31 + 1374 = ~1405 GiB → split ~1000 / ~405 GiB.
(Exact split depends on sector alignment from sgdisk output — fill in after running it.)

### New btrfs subvolume layout (NEW-a)

```
@arch             → /
@arch-snapshots   → /.snapshots
@void             → /mnt/void
@void-snapshots   → /mnt/void/.snapshots
@home             → /home
@data             → /data
@nix              → /nix
```

`@arch-var`, `@void-var`, `@home-cache`, `@docker` are **removed** — those workloads move to XFS.

### New XFS directory layout (NEW-b) — bind mounted

```
/mnt/xfs/
  var-arch/         ← bind → /var          (Arch fstab)
  var-void/         ← bind → /var          (Void fstab)
  cache/            ← bind → /home/shad/.cache
  docker/           ← bind → /var/lib/docker
  databases/        ← bind → /var/lib/postgresql, /var/lib/redis, etc.
  immich/
    thumbnails/
    vectors/
    media-cache/
```

**Why XFS:** no copy-on-write by default. Databases, thumbnails, Docker overlay2, and `~/.cache` all generate heavy small-random writes — on btrfs these trigger CoW chains that amplify writes 3–5× and generate heat. XFS writes in-place.

---

## New fstab (Arch) — template for after migration

Replace `<NEW-BTRFS>` with new UUID from `blkid /dev/nvme0n1pX` after mkfs.
Replace `<NEW-XFS>` with new UUID from `blkid /dev/nvme0n1pY` after mkfs.

```fstab
# ── btrfs pool ───────────────────────────────────────────────────────────────
UUID=<NEW-BTRFS>  /             btrfs  rw,relatime,compress=zstd,ssd,discard=async,space_cache=v2,subvol=/@arch            0 0
UUID=<NEW-BTRFS>  /.snapshots   btrfs  rw,relatime,compress=zstd,ssd,discard=async,space_cache=v2,subvol=/@arch-snapshots  0 0
UUID=<NEW-BTRFS>  /home         btrfs  rw,relatime,compress=zstd,ssd,discard=async,space_cache=v2,subvol=/@home            0 0
UUID=<NEW-BTRFS>  /data         btrfs  rw,relatime,compress=zstd,ssd,discard=async,space_cache=v2,subvol=/@data            0 0
UUID=<NEW-BTRFS>  /nix          btrfs  rw,relatime,compress=zstd,ssd,discard=async,space_cache=v2,subvol=/@nix             0 0
UUID=<NEW-BTRFS>  /mnt/void     btrfs  rw,relatime,compress=zstd,ssd,discard=async,space_cache=v2,nofail,subvol=/@void     0 0
UUID=<NEW-BTRFS>  /mnt/pool     btrfs  rw,relatime,ssd,discard=async,space_cache=v2,nofail                                 0 0

# ── /boot and EFI (UUIDs unchanged from original) ────────────────────────────
UUID=fba989bd-2a90-4e11-9aa2-4c941d3e0460  /boot      ext4   defaults  0 2
UUID=1A4A-CE0B                             /boot/efi  vfat   defaults  0 0

# ── Windows ──────────────────────────────────────────────────────────────────
UUID=70C033CAC0339576  /mnt/windows  ntfs3  rw,nosuid,nodev,uid=1000,gid=1000,nofail  0 0

# ── XFS high-write partition ──────────────────────────────────────────────────
UUID=<NEW-XFS>  /mnt/xfs  xfs  rw,noatime  0 0

# ── bind mounts from XFS ──────────────────────────────────────────────────────
/mnt/xfs/var-arch          /var                 none  bind  0 0
/mnt/xfs/cache             /home/shad/.cache    none  bind  0 0
/mnt/xfs/docker            /var/lib/docker      none  bind  0 0
/mnt/xfs/databases         /var/lib/postgresql  none  bind  0 0
```

---

## GRUB After Migration

GRUB entries live in `/etc/grub.d/06_custom` (not generated — hand-edited). After migration, **only the btrfs UUID changes**. The `search --fs-uuid` line uses p8's UUID which is preserved.

### What to update in `/etc/grub.d/06_custom`

Find and replace every occurrence of:

```
root=UUID=e2671b81-6b31-4df2-bed9-63b3f4b3d48b
```

with:

```
root=UUID=<NEW-BTRFS>
```

That's the only change needed. Then regenerate:

```bash
grub-mkconfig -o /boot/grub/grub.cfg
```

The `search --no-floppy --fs-uuid --set=root fba989bd-...` lines find p8 (/boot) and do **not** need changing.

### `/etc/default/grub` settings to verify after restore

```bash
GRUB_CMDLINE_LINUX_DEFAULT="loglevel=3 i915.enable_psr=0 i915.enable_fbc=0 nvidia-drm.modeset=1 nvidia.NVreg_PreserveVideoMemoryAllocations=0"
GRUB_DEFAULT=saved
GRUB_SAVEDEFAULT=true
GRUB_TIMEOUT=15
GRUB_THEME="/boot/grub/themes/pika/theme.txt"
GRUB_DISABLE_OS_PROBER=false
```

`grub-install` is **not required** if p1 is restored correctly — `EFI/GRUB/grubx64.efi` is already in place and the EFI NVRAM entry (Boot0001) already points to it. Only run `grub-install` if the first boot attempt fails at the EFI level.

---

## Step-by-Step Migration Procedure

### Phase 1 — Complete the backup (items still missing)

```bash
# Mount external if not already
mount /dev/sda1 /mnt/external

# 1d — Back up @nix
sudo rsync -aHAX --info=progress2 /nix/ /mnt/external/nix-bak/

# 1e — Back up Steam game saves
cp -a ~/.cache/managed-steam/Steam/userdata/ /mnt/external/steam-userdata/

# 1f — Save partition table with exact sectors (CRITICAL — GPT is wiped by sanitize)
sudo sgdisk --backup=/mnt/external/nvme-gpt-backup.bin /dev/nvme0n1
sudo sgdisk --print /dev/nvme0n1 | tee /mnt/external/nvme-partitions.txt

# Optional — back up Nichijou if you care about it
rsync -aHAX --info=progress2 /data/media/anime/Nichijou/ /mnt/external/media/anime/Nichijou/

# Verify external has everything
df -h /mnt/external
ls /mnt/external/
```

### Phase 2 — Sanitize

Run from **recovery partition (p9) or USB** — not from the running system.

```bash
# Boot into p9 recovery, then:
mount /dev/sda1 /mnt/external   # keep backup drive accessible

# Verify backup before destroying anything
ls /mnt/external/{@arch_bak,@home_bak,boot,efi,nix-bak,steam-userdata}

# Check sanitize capability
nvme sanitize-log /dev/nvme0n1

# Block-erase sanitize — destroys ALL data including partition table
nvme sanitize --sanact=2 /dev/nvme0n1

# Monitor (wait for Sanitize Progress = 65535)
watch -n5 nvme sanitize-log /dev/nvme0n1

# Verify errors cleared
nvme smart-log /dev/nvme0n1
# Expect: media_errors=0, critical_warning=0x0
```

### Phase 3 — Repartition

After sanitize the GPT is gone. Recreate it using the saved sector numbers from `/mnt/external/nvme-partitions.txt`.

```bash
mount /dev/sda1 /mnt/external
cat /mnt/external/nvme-partitions.txt   # reference for exact sectors

# Create a new GPT
sgdisk --zap-all /dev/nvme0n1

# Recreate p1 (EFI) — use exact sectors from nvme-partitions.txt
sgdisk -n 1:<start>:<end> -t 1:ef00 -c 1:"EFI system partition" /dev/nvme0n1

# Recreate p2 (MSR)
sgdisk -n 2:<start>:<end> -t 2:0c01 -c 2:"Microsoft reserved" /dev/nvme0n1

# Recreate p3 (NTFS/Windows)
sgdisk -n 3:<start>:<end> -t 3:0700 -c 3:"Basic data partition" /dev/nvme0n1

# Recreate p8 (/boot)
sgdisk -n 8:<start>:<end> -t 8:8300 -c 8:"boot" /dev/nvme0n1

# Recreate p9 (recovery)
sgdisk -n 9:<start>:<end> -t 9:8300 -c 9:"recovery" /dev/nvme0n1

# Create NEW-a (btrfs pool) — starts where p4 used to begin (right after p9)
# NEW-b (xfs) — fills remaining space to end of disk
# Adjust sizes based on actual free space; ~1000 GiB btrfs / ~405 GiB xfs is the target
sgdisk -n 10:0:+1000GiB -t 10:8300 -c 10:"linux-pool" /dev/nvme0n1
sgdisk -n 11:0:0        -t 11:8300 -c 11:"xfs-shared"  /dev/nvme0n1

partprobe /dev/nvme0n1
lsblk /dev/nvme0n1   # verify before proceeding
```

### Phase 4 — Restore /boot and /boot/efi with original UUIDs

Restoring UUIDs means fstab and GRUB config need zero changes for these partitions.

```bash
mount /dev/sda1 /mnt/external

# Restore p8 (/boot) — preserve UUID fba989bd-...
mkfs.ext4 -L boot -U fba989bd-2a90-4e11-9aa2-4c941d3e0460 /dev/nvme0n1p8
mkdir -p /mnt/boot-r
mount /dev/nvme0n1p8 /mnt/boot-r
cp -a /mnt/external/boot/. /mnt/boot-r/
umount /mnt/boot-r

# Restore p1 (/boot/efi) — preserve UUID 1A4A-CE0B
# FAT volume ID = 1A4ACE0B (the -i flag takes it without the dash)
mkfs.fat -F32 -n "EFI" -i 1A4ACE0B /dev/nvme0n1p1
mkdir -p /mnt/efi-r
mount /dev/nvme0n1p1 /mnt/efi-r
cp -a /mnt/external/efi/. /mnt/efi-r/
umount /mnt/efi-r

# Verify UUIDs match
blkid /dev/nvme0n1p1   # should show 1A4A-CE0B
blkid /dev/nvme0n1p8   # should show fba989bd-2a90-4e11-9aa2-4c941d3e0460
```

### Phase 5 — Create btrfs and XFS filesystems

```bash
# pX = nvme0n1p10 (or whatever number sgdisk assigned to NEW-a)
# pY = nvme0n1p11 (NEW-b)
mkfs.btrfs -L linux-pool /dev/nvme0n1p10
mkfs.xfs   -L xfs-shared /dev/nvme0n1p11

# Note new UUIDs — needed for fstab
NEW_BTRFS=$(blkid -s UUID -o value /dev/nvme0n1p10)
NEW_XFS=$(blkid -s UUID -o value /dev/nvme0n1p11)
echo "NEW_BTRFS=$NEW_BTRFS"
echo "NEW_XFS=$NEW_XFS"

# Mount btrfs and create subvolumes
mount /dev/nvme0n1p10 /mnt/new
btrfs subvolume create /mnt/new/@arch
btrfs subvolume create /mnt/new/@arch-snapshots
btrfs subvolume create /mnt/new/@void
btrfs subvolume create /mnt/new/@void-snapshots
btrfs subvolume create /mnt/new/@home
btrfs subvolume create /mnt/new/@data
btrfs subvolume create /mnt/new/@nix

# Mount XFS and create directory tree
mount /dev/nvme0n1p11 /mnt/xfs
mkdir -p /mnt/xfs/{var-arch,var-void,cache,docker,databases,immich/thumbnails,immich/vectors,immich/media-cache}
```

### Phase 6 — Restore subvolumes and data

Backups are plain directory copies. Restore by rsyncing into the new subvolumes.

```bash
mount /dev/sda1 /mnt/external

# ── btrfs subvolumes ──────────────────────────────────────────────────────────
for subvol in @arch @void @home; do
  echo "Restoring $subvol..."
  rsync -aHAX --info=progress2 /mnt/external/${subvol}_bak/ /mnt/new/${subvol}/
done

# @nix
rsync -aHAX --info=progress2 /mnt/external/nix-bak/ /mnt/new/@nix/

# ── /data — restore into @data subvolume ──────────────────────────────────────
mkdir -p /mnt/new/@data/{hdd,ops,stash,code,media,downloads,screens}
for d in hdd ops stash code downloads screens; do
  rsync -aHAX --info=progress2 /mnt/external/$d/ /mnt/new/@data/$d/
done
# media subdirs
for d in music audiobook books games; do
  rsync -aHAX --info=progress2 /mnt/external/media/$d/ /mnt/new/@data/media/$d/
done

# ── @arch-var → XFS var-arch ──────────────────────────────────────────────────
rsync -aHAX --info=progress2 /mnt/external/@arch-var_bak/ /mnt/xfs/var-arch/

# ── @void-var → XFS var-void ──────────────────────────────────────────────────
rsync -aHAX --info=progress2 /mnt/external/@void-var_bak/ /mnt/xfs/var-void/

# ── Steam game saves → XFS cache (or home, see note) ─────────────────────────
# Steam expects ~/.cache/managed-steam/Steam/userdata/ via the symlink
# The symlink ~/.local/share/Steam → ~/.cache/managed-steam/Steam is in @home_bak
# So userdata needs to be in the XFS cache mount:
mkdir -p /mnt/xfs/cache/managed-steam/Steam/
cp -a /mnt/external/steam-userdata/ /mnt/xfs/cache/managed-steam/Steam/userdata/
```

### Phase 7 — chroot and update configuration

```bash
# Mount new root
mount -o subvol=/@arch /dev/nvme0n1p10 /mnt/new-root
mount /dev/nvme0n1p8  /mnt/new-root/boot       # already populated
mount /dev/nvme0n1p1  /mnt/new-root/boot/efi   # already populated
mount --bind /proc /mnt/new-root/proc
mount --bind /sys  /mnt/new-root/sys
mount --bind /dev  /mnt/new-root/dev
mount --bind /run  /mnt/new-root/run
arch-chroot /mnt/new-root

# ── Inside chroot ─────────────────────────────────────────────────────────────

# 1. Get new btrfs UUID
NEW_BTRFS=$(blkid -s UUID -o value /dev/nvme0n1p10)
NEW_XFS=$(blkid -s UUID -o value /dev/nvme0n1p11)
echo "btrfs=$NEW_BTRFS  xfs=$NEW_XFS"

# 2. Update /etc/fstab — replace old btrfs UUID and rewrite to new layout
#    Use the fstab template from this document, substituting NEW_BTRFS and NEW_XFS
sed -i "s/e2671b81-6b31-4df2-bed9-63b3f4b3d48b/${NEW_BTRFS}/g" /etc/fstab
# Then manually remove the old @arch-var, @arch-snapshots (if old format),
# @home-cache, @docker lines and add XFS + bind mount lines per the template above.
# Verify:
cat /etc/fstab

# 3. Update GRUB custom entries — only the btrfs UUID in root= needs changing
sed -i "s/e2671b81-6b31-4df2-bed9-63b3f4b3d48b/${NEW_BTRFS}/g" /etc/grub.d/06_custom
grep "root=UUID" /etc/grub.d/06_custom   # should show new UUID only

# 4. Regenerate initramfs (btrfs UUID embedded in early-mount)
mkinitcpio -P

# 5. Regenerate grub.cfg from updated 06_custom
grub-mkconfig -o /boot/grub/grub.cfg

# 6. Sanity-check — old UUID must not appear anywhere in grub.cfg
grep "e2671b81" /boot/grub/grub.cfg && echo "ERROR: old UUID still present" || echo "OK"

# Exit chroot
exit
```

### Phase 8 — Validate after first boot

```bash
# SMART — must show cleared errors
nvme smart-log /dev/nvme0n1
# Expect: critical_warning=0x0, media_errors=0

# Filesystem health
btrfs check --readonly /dev/nvme0n1p10

# All mounts present
lsblk -o NAME,UUID,MOUNTPOINT
findmnt --list | grep -E "btrfs|xfs|vfat|ext4"

# No failed units
systemctl --failed

# No block device errors in journal
journalctl -p err -b | grep -i "nvme\|btrfs\|xfs\|blk"

# Docker — restart and verify overlay2 on XFS
docker info | grep "Storage Driver"   # should be overlay2
systemctl restart docker
docker ps

# Lidarr / Prowlarr — check DBs came up clean
systemctl status lidarr prowlarr
```

---

## Thermal Mitigation Notes

| Old (problematic)                 | New (mitigated)                   |
| --------------------------------- | --------------------------------- |
| Immich thumbnails on btrfs        | XFS `/mnt/xfs/immich/thumbnails/` |
| Immich face vectors on btrfs      | XFS `/mnt/xfs/immich/vectors/`    |
| Docker overlay2 on btrfs          | XFS `/mnt/xfs/docker/`            |
| `~/.cache` on btrfs (CoW)         | XFS `/mnt/xfs/cache/`             |
| `/var` (logs, pacman db) on btrfs | XFS `/mnt/xfs/var-arch/`          |

Additionally: monitor NVMe temps after migration. If sensor 1 still hits 55°C+ under Immich load, consider `nvme set-feature` to lower thermal throttle threshold or improve case airflow.

Consider enabling `zram` for swap to avoid OOM situations without adding NVMe write pressure.

---

## Key UUIDs

| Device                 | UUID                                             | After migration                                      |
| ---------------------- | ------------------------------------------------ | ---------------------------------------------------- |
| nvme0n1p1              | `1A4A-CE0B`                                      | **Preserved** — restored with `mkfs.fat -i 1A4ACE0B` |
| nvme0n1p7 (btrfs, old) | `e2671b81-6b31-4df2-bed9-63b3f4b3d48b`           | **Gone** — replaced by new btrfs                     |
| nvme0n1p8              | `fba989bd-2a90-4e11-9aa2-4c941d3e0460`           | **Preserved** — restored with `mkfs.ext4 -U`         |
| nvme0n1p9              | `c3ea4d04-fe9a-47ff-ad23-a97de108817e`           | Unchanged (partition kept)                           |
| nvme0n1p3              | `70C033CAC0339576`                               | Unchanged (partition kept)                           |
| NEW-a (btrfs)          | _assigned at mkfs — update in fstab + 06_custom_ | —                                                    |
| NEW-b (xfs)            | _assigned at mkfs — update in fstab_             | —                                                    |
| sda1 (external)        | mounted at /mnt/external, btrfs                  | backup drive                                         |

**What needs updating after migration:**

- `/etc/fstab`: replace `e2671b81-...` UUID throughout; remove old subvol entries; add XFS + bind mounts
- `/etc/grub.d/06_custom`: replace `e2671b81-...` in every `root=UUID=` line
- Run `grub-mkconfig` to regenerate `/boot/grub/grub.cfg`
- p8 UUID (`fba989bd-...`) and p1 UUID (`1A4A-CE0B`) references: **no changes needed**
- EFI NVRAM (Boot0001 pointing to `EFI\GRUB\grubx64.efi`): **no changes needed**
- `grub-install`: **not needed** unless EFI binary is missing after restore

---

## Sudo Commands Needed Before Wipe

Run these now on the live system and paste output into this doc:

```bash
# 1. Exact partition table sectors (fill in the PASTE block above under "Current Disk Layout")
sudo sgdisk --print /dev/nvme0n1

# 2. Full btrfs subvolume list with IDs (fill in the PASTE block under "Current btrfs subvolumes")
sudo btrfs subvolume list /mnt/pool

# 3. Current SMART state snapshot (append to the SMART table above for comparison post-migration)
sudo nvme smart-log /dev/nvme0n1
```
