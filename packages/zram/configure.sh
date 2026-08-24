#!/usr/bin/env bash
# Install zram config into /etc as REAL FILES — deliberately NOT `dot link`ed.
#
# Why: /data is a btrfs-pool subvolume that is NOT mounted yet when zram is set up.
#   * zram-generator is a systemd *generator* — it runs before any unit, earliest in boot
#   * systemd-modules-load runs at sysinit, ~1s before data.mount
#   * runit's 08-sysctl.sh core service runs before any filesystem beyond / is up
# A symlink into /data resolves to nothing there, and no consumer errors usefully —
# they treat the config as absent and you simply boot with no swap:
#   zram_generator::config: No configuration found.
#   systemd-modules-load: Failed to chase '/etc/modules-load.d/zram.conf'
# That cost a 9-day silent swap outage (2026-07-19 -> 07-28). It looked like it worked
# because `systemctl daemon-reload` re-runs generators *after* /data is mounted, so swap
# would appear hours into a boot from some unrelated reload.
#
# These files live under etc-real*/ rather than system/ ON PURPOSE: dot's linker only walks
# home/ and system/ (/data/code/fleet/apps/dot/src/lib/pkg.ts collectFiles), so `dot link zram` physically cannot
# recreate the symlink. The dot copy is the reference; /etc is authoritative. Change both.
# See docs/zram.md and the "Early boot" section of /data/ops/CLAUDE.md.
#
# Three trees, because this box dual-boots Arch (systemd) and Void (runit):
#   etc-real/          both inits  — sysctl.d reclaim watermarks, modules-load.d/zram.conf
#   etc-real-systemd/  Arch only   — zram-generator.conf, tmpfiles.d/zswap.conf
#   etc-real-runit/    Void only   — /etc/sv/zramen/conf
#
# modules-load.d is in the SHARED tree, which is easy to get wrong: it looks like a systemd
# mechanism, but Void reads it too. /etc/runit/core-services/02-kmods.sh runs `modules-load`
# from the runit-void package, and that tool documents itself as "modules-load.d(5)
# compatible" and globs /{etc,run,usr/lib}/modules-load.d/*.conf. So the file belongs to both
# inits and is installed on purpose on Void rather than as a side effect.
#
# The shared tree is not optional on either side: the watermark tuning is what keeps zsmalloc
# able to allocate under pressure, and without it BOTH boots can livelock the same way Arch
# did between 2026-07-28 and 08-01. See docs/zram.md, "The 0.75 freeze".
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO="sudo"

# /run/systemd/system, NOT /run/systemd — this is systemd's own sd_booted() test.
#
# Void runs elogind, which creates /run/systemd/{seats,sessions,users,machines,inhibit} to
# provide the logind D-Bus API. So `[ -d /run/systemd ]` is TRUE on Void, and this script
# spent its whole life mis-detecting the Void boot as systemd: it installed
# zram-generator.conf/modules-load.d/tmpfiles.d into Void's /etc, never installed
# /etc/sv/zramen/conf at all, and then died on `systemctl: command not found`. Net effect —
# Void ran on zramen's built-in defaults (lz4, priority 32767, no size ceiling) for as long
# as this file has existed, while appearing to be configured. Only /run/systemd/system is
# created exclusively by systemd as PID 1.
if [ -d /run/systemd/system ]; then
  INIT=systemd
elif [ -d /etc/sv ]; then
  INIT=runit
else
  echo "zram: unrecognised init (no /run/systemd/system, no /etc/sv) — nothing to do" >&2
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

install_tree() { # $1 = tree root under $DIR
  local root=$1
  [ -d "$root" ] || return 0
  while IFS= read -r -d '' src; do
    install_real "$src" "${src#"$root"}"
  done < <(find "$root" -type f -print0 | sort -z)
}

echo "zram: installing real files into /etc for init=$INIT (never symlinks — see header)"
install_tree "$DIR/etc-real"
install_tree "$DIR/etc-real-$INIT"

# Reclaim watermarks. Both inits read /etc/sysctl.d — systemd via systemd-sysctl.service,
# Void via /etc/runit/core-services/08-sysctl.sh. Apply now so configure is not a no-op
# until the next reboot.
$SUDO sysctl --system >/dev/null 2>&1 ||
  $SUDO sysctl -p /etc/sysctl.d/30-reclaim.conf >/dev/null # runit's sysctl has no --system

# zswap OFF. Not optional, and not a tuning preference: stacked in front of zram it
# double-compresses every anon page and adds an allocate-to-reclaim step ahead of zsmalloc's
# — the same class of hazard as the 0.75 freeze. linux-zen sets CONFIG_ZSWAP_DEFAULT_ON=y, so
# doing nothing means it is ON. Written directly here as well as declared in tmpfiles.d so
# configure is not a no-op until the next boot. Both inits, since both boot this kernel.
if [ -w /sys/module/zswap/parameters/enabled ] || [ -e /sys/module/zswap/parameters/enabled ]; then
  echo N | $SUDO tee /sys/module/zswap/parameters/enabled >/dev/null || true
fi

if [ "$INIT" = systemd ]; then
  $SUDO systemctl daemon-reload # re-runs the generator so dev-zram0.swap exists now

  # Apply the tmpfiles.d entry now rather than waiting for sysinit.target on the next boot.
  $SUDO systemd-tmpfiles --create /etc/tmpfiles.d/zswap.conf >/dev/null 2>&1 || true

  # Only touch the device if it is not already live — restarting the setup unit under an
  # active swap device fails on EBUSY. A resize therefore needs a reboot, by design: we are
  # not swapoff'ing a device with gigabytes of live anonymous pages on it.
  if ! swapon --show=NAME --noheadings 2>/dev/null | grep -qx '/dev/zram0'; then
    $SUDO systemctl start systemd-zram-setup@zram0.service || true
    $SUDO systemctl start dev-zram0.swap || true
  fi
else
  # zramen reads ./conf from its service dir at start and modprobes zram itself, so there is
  # no modules-load.d equivalent to install. Restart only if already supervised; enabling is
  # `dot pkg zram enable --init runit` (symlinks /etc/sv/zramen into /var/service).
  if [ -e /var/service/zramen ]; then
    $SUDO sv restart zramen || true
  else
    echo
    echo "  zramen is not enabled yet:  dot pkg zram enable --init runit"
  fi
fi

echo
swapon --show || echo "  (no swap active)"
printf 'min_free_kbytes   : %s\n' "$(sysctl -n vm.min_free_kbytes)"
printf 'watermark_scale   : %s\n' "$(sysctl -n vm.watermark_scale_factor)"
printf 'zswap enabled     : %s (want N)\n' "$(cat /sys/module/zswap/parameters/enabled 2>/dev/null || echo 'n/a')"
echo
echo "Verify on a FRESH BOOT, not after a daemon-reload — a reload masks the /data bug:"
echo "  swapon --show | grep zram"
