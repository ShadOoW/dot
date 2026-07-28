#!/usr/bin/env bash
# Install zram config into /etc as REAL FILES — deliberately NOT `dot link`ed.
#
# Why: /data is a btrfs-pool subvolume that is NOT mounted yet when zram is set up.
#   * zram-generator is a systemd *generator* — it runs before any unit, earliest in boot
#   * systemd-modules-load runs at sysinit, ~1s before data.mount
# A symlink into /data resolves to nothing there, and neither consumer errors usefully —
# they treat the config as absent and you simply boot with no swap:
#   zram_generator::config: No configuration found.
#   systemd-modules-load: Failed to chase '/etc/modules-load.d/zram.conf'
# That cost a 9-day silent swap outage (2026-07-19 -> 07-28). It looked like it worked
# because `systemctl daemon-reload` re-runs generators *after* /data is mounted, so swap
# would appear hours into a boot from some unrelated reload.
#
# These files live under etc-real/ rather than system/ ON PURPOSE: dot's linker only walks
# home/ and system/ (src/lib/pkg.ts collectFiles), so `dot link zram` physically cannot
# recreate the symlink. The dot copy is the reference; /etc is authoritative. Change both.
# See docs/zram.md and the "Early boot" section of /data/ops/CLAUDE.md.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO="sudo"

# Everything below is systemd-specific: zram-generator and modules-load.d are systemd
# mechanisms. Void does zram with `zramen` (see meta.json xbps + enable-runit.sh), so on
# runit this script has nothing to do and must not litter /etc with inert files.
if [ ! -d /run/systemd ]; then
  echo "not a systemd system — Void uses zramen instead:"
  echo "  dot pkg zram enable --init runit"
  exit 0
fi

install_real() { # $1 = source in dot, $2 = destination under /etc
  local src=$1 dst=$2
  [ -f "$src" ] || {
    echo "missing source: $src" >&2
    exit 1
  }
  if [ ! -L "$dst" ] && [ -f "$dst" ] && cmp -s "$src" "$dst"; then
    printf '  ok         %s\n' "$dst"
    return 0
  fi
  # rm FIRST: writing to a symlink path follows the link and would clobber the dot copy.
  $SUDO rm -f "$dst"
  $SUDO install -D -m644 "$src" "$dst"
  [ -L "$dst" ] && {
    echo "still a symlink: $dst" >&2
    exit 1
  }
  printf '  installed  %s\n' "$dst"
}

echo "zram: installing real files into /etc (never symlinks — see this script's header)"
while IFS= read -r -d '' src; do
  install_real "$src" "${src#"$DIR/etc-real"}"
done < <(find "$DIR/etc-real" -type f -print0 | sort -z)

$SUDO systemctl daemon-reload # re-runs the generator so dev-zram0.swap exists now

# Only touch the device if it is not already live — restarting the setup unit under an
# active swap device fails on EBUSY.
if ! swapon --show=NAME --noheadings 2>/dev/null | grep -qx '/dev/zram0'; then
  $SUDO systemctl start systemd-zram-setup@zram0.service || true
  $SUDO systemctl start dev-zram0.swap || true
fi

echo
swapon --show || echo "  (no swap active)"
echo
echo "Verify on a FRESH BOOT, not after a daemon-reload — a reload masks this bug:"
echo "  swapon --show | grep zram0"
