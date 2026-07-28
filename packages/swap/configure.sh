#!/usr/bin/env bash
# Disk-backed swapfile on the XFS engine partition (nvme0n1p9, /mnt/engine).
#
# WHY, given zram already exists: zram is RAM compressed in RAM (~2-3:1 with zstd). It
# buys headroom, not a second tier — a workload that genuinely wants more than physical
# RAM still gets OOM-killed. On 2026-07-28 the kernel OOM-killed this box *with* 23 GiB
# of zram fully engaged. A disk swapfile is the only thing that adds real capacity.
#
# Priority matters: zram is pri=100, this is pri=10, so the kernel fills fast compressed
# RAM first and only spills to NVMe under genuine pressure.
#
# /mnt/engine is XFS and is mounted at the SAME path under Void, so both OSes can share
# this one file (never simultaneously — they don't run at once). Void needs its own fstab
# line; this script prints it. See README.md.
set -euo pipefail
SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO="sudo"

SWAPFILE=/mnt/engine/swapfile
SIZE_GIB=16
PRIORITY=10
FSTAB_LINE="$SWAPFILE  none  swap  defaults,pri=$PRIORITY  0 0"

mountpoint -q /mnt/engine || {
  echo "/mnt/engine is not mounted — aborting" >&2
  exit 1
}

avail_gib=$(df --output=avail -BG /mnt/engine | tail -1 | tr -dc '0-9')
if [ "$avail_gib" -lt $((SIZE_GIB + 10)) ]; then
  echo "only ${avail_gib}G free on /mnt/engine, need $((SIZE_GIB + 10))G — aborting" >&2
  exit 1
fi

# ---------------------------------------------------------------- create the file
if [ -f "$SWAPFILE" ]; then
  echo "ok: $SWAPFILE already exists ($(du -h "$SWAPFILE" | cut -f1))"
else
  echo "creating ${SIZE_GIB}GiB $SWAPFILE (dd, not fallocate — swapon rejects the"
  echo "unwritten extents fallocate leaves behind on XFS)"
  $SUDO dd if=/dev/zero of="$SWAPFILE" bs=1M count=$((SIZE_GIB * 1024)) status=progress
  $SUDO chown root:root "$SWAPFILE"
  $SUDO chmod 600 "$SWAPFILE"
  $SUDO mkswap "$SWAPFILE"
fi

# Permissions are a hard requirement, not cosmetic: swapon refuses a world-readable file.
$SUDO chmod 600 "$SWAPFILE"
$SUDO chown root:root "$SWAPFILE"

# ------------------------------------------------------------------ fstab (Arch)
# systemd's fstab generator turns this into a .swap unit with an automatic
# RequiresMountsFor=/mnt/engine, so it cannot race the mount.
if grep -qF "$SWAPFILE" /etc/fstab; then
  echo "ok: /etc/fstab already references $SWAPFILE"
else
  printf '\n# Disk-backed swap behind zram (zram pri=100 is used first)\n%s\n' "$FSTAB_LINE" |
    $SUDO tee -a /etc/fstab >/dev/null
  echo "added to /etc/fstab: $FSTAB_LINE"
  $SUDO systemctl daemon-reload
fi

# ----------------------------------------------------------------------- activate
if swapon --show=NAME --noheadings 2>/dev/null | grep -qx "$SWAPFILE"; then
  echo "ok: already active"
else
  $SUDO swapon --priority "$PRIORITY" "$SWAPFILE"
  echo "activated"
fi

echo
swapon --show
echo
cat <<EOF
------------------------------------------------------------------------
DUAL BOOT: Void does NOT pick this up automatically. Add to
/mnt/void/etc/fstab (Void mounts /mnt/engine at the same path, so the
path is already correct there):

$FSTAB_LINE

Void's runit core-services run 'swapon -a', so an fstab line is all it
needs. Do NOT run mkswap again from Void — the file is already formatted
and re-running it would just churn the UUID.

Note Void handles zram with 'zramen', not zram-generator (systemd-only),
so the zram half of this setup is Arch-only by design.
------------------------------------------------------------------------
EOF
