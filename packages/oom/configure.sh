#!/usr/bin/env bash
# Memory safety, minimal edition. Three moving parts, no more:
#
#   1. earlyoom          — kills the largest offending PROCESS before the kernel's blunt
#                          last-resort OOM killer runs (which killed the session manager).
#   2. memory floors     — reserve a floor of unreclaimable memory for system services, and
#                          undo upstream's OOMScoreAdjust=100 on user@.service.  systemd only.
#   3. oom-notify        — a session-scoped notifier that raises a red, non-expiring
#                          notification on any OOM kill (kernel, earlyoom, or systemd-oomd).
#
# Deliberately NOT enabling systemd-oomd: sway is started by ly rather than a systemd user
# session, so every GUI app shares ONE cgroup (session-c1.scope, ~15.3 GiB). oomd kills at
# cgroup granularity, so its only move would be killing the whole session — a logout.
# See etc-real-systemd/etc/systemd/system/earlyoom.service.d/10-args.conf for the reasoning
# behind every threshold; it is the single source of truth and the runit service points at it.
#
# ── Both inits, and what differs ─────────────────────────────────────────────────────────
#
#   etc-real-systemd/  Arch   earlyoom drop-in, system.slice MemoryMin, user@ OOMScoreAdjust
#   etc-real-runit/    Void   /etc/sv/earlyoom{,/log}, kernel.dmesg_restrict=0
#
# Part 2 has no runit equivalent and is not faked: MemoryMin is a cgroup-v2 knob applied by
# systemd to units, and runit does not put services in cgroups at all. On Void the floor is
# simply absent — earlyoom's --avoid list is what keeps the session and system plumbing alive
# there, which is why that list is spelled out separately for Void's process names.
#
# The /etc files live under etc-real*/ rather than system/ because unit drop-ins, runit service
# dirs and sysctl.d are all read before /data is mounted (or, for runsvdir, early enough that
# depending on the btrfs pool is a bad trade). dot's linker only walks home/ and system/
# (src/lib/pkg.ts collectFiles), so they physically cannot be symlinked. See AGENTS.md.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO="sudo"

if [ -d /run/systemd/system ]; then
  INIT=systemd
elif [ -d /etc/sv ]; then
  INIT=runit
else
  echo "oom: unrecognised init (no /run/systemd/system, no /etc/sv) — nothing to do" >&2
  exit 0
fi
echo "oom: configuring for init=$INIT"

# ------------------------------------------------------------------- 1. the package
if ! command -v earlyoom >/dev/null 2>&1; then
  echo "installing earlyoom..."
  case "$INIT" in
    systemd) $SUDO pacman -S --needed --noconfirm earlyoom libnotify ;;
    runit) $SUDO xbps-install -y earlyoom libnotify ;;
  esac
fi

# --------------------------------------------------- 2. real files under /etc
install_real() {
  local src=$1 dst=$2 mode=$3
  if [ ! -L "$dst" ] && [ -f "$dst" ] && cmp -s "$src" "$dst"; then
    printf '  ok         %s\n' "$dst"
    return 0
  fi
  $SUDO rm -f "$dst" # rm first, else we write *through* a symlink
  $SUDO install -D -m"$mode" "$src" "$dst"
  [ -L "$dst" ] && {
    echo "still a symlink: $dst" >&2
    exit 1
  }
  printf '  installed  %s\n' "$dst"
}

echo "installing $INIT files (real files, never symlinks):"
while IFS= read -r -d '' src; do
  # runit `run` scripts must be executable or runsv spins on them; everything else is data.
  mode=644
  [ "$(basename "$src")" = run ] && mode=755
  install_real "$src" "${src#"$DIR/etc-real-$INIT"}" "$mode"
done < <(find "$DIR/etc-real-$INIT" -type f -print0 | sort -z)

# ------------------------------------------------------------------- 3. earlyoom
if [ "$INIT" = systemd ]; then
  $SUDO systemctl daemon-reload
  $SUDO systemctl enable earlyoom.service
  # restart, not `enable --now`: `start` is a no-op on an already-running unit, so a changed
  # ExecStart in 10-args.conf would sit on disk without ever reaching the running process.
  $SUDO systemctl restart earlyoom.service
  # Prove the ExecStart override took, rather than assuming it did.
  echo
  echo "earlyoom argv now in effect:"
  systemctl show earlyoom.service -p ExecStart --value | tr ' ' '\n' | grep -E '^(argv|-|\^)' | head -8 || true
else
  # svlogd reads its rotation policy from a `config` file inside the LOG directory, which does
  # not exist until the service first runs — so it cannot ship in etc-real-runit/ and is
  # written here instead. n4/s1000000 = four 1 MB files.
  $SUDO install -d -m755 /var/log/earlyoom
  printf 's1000000\nn4\n' | $SUDO tee /var/log/earlyoom/config >/dev/null

  # Void's earlyoom package may ship its own /etc/sv/earlyoom/run; ours has already replaced
  # it above (install_real rm's first), which is the point — the thresholds are the payload.
  if [ ! -e /var/service/earlyoom ]; then
    echo "enabling earlyoom service"
    $SUDO ln -sfn /etc/sv/earlyoom /var/service/earlyoom
    # runsvdir polls every 5s; wait so the report below reflects reality.
    sleep 6
  fi
  # `sv restart` is a no-op-safe way to pick up a changed run script. `|| true` because a
  # service that has never started yet has no supervise/ dir for the first second or two.
  $SUDO sv restart earlyoom || true

  # kernel.dmesg_restrict=0 — apply now instead of waiting for the next boot's 08-sysctl.sh.
  $SUDO sysctl -p /etc/sysctl.d/31-dmesg.conf >/dev/null
fi

# ------------------------------------------------------ 4. the notifier
# `dot link oom` must have run first so ~/.local/bin/oom-notify exists.
if [ ! -x "$HOME/.local/bin/oom-notify" ]; then
  echo "NOTE: ~/.local/bin/oom-notify missing — run 'dot link oom' then re-run configure" >&2
elif [ "$INIT" = systemd ]; then
  systemctl --user daemon-reload
  systemctl --user enable --now oom-notify.service
  echo "oom-notify: $(systemctl --user is-active oom-notify.service)"
else
  # No systemd user manager on Void, so there is no user unit to enable. The notifier needs
  # the session D-Bus anyway, so sway's exec block is the correct owner — see packages/sway,
  # which starts it next to mako. Nudge a running session so configure is not a no-op.
  if pgrep -x oom-notify >/dev/null 2>&1; then
    echo "oom-notify: already running in this session"
  elif [ -n "${SWAYSOCK:-}" ]; then
    swaymsg exec "$HOME/.local/bin/oom-notify" >/dev/null 2>&1 &&
      echo "oom-notify: started in the running sway session" ||
      echo "oom-notify: could not start via swaymsg; it will start at next login" >&2
  else
    echo "oom-notify: not running — starts from sway's exec block at next login"
  fi
fi

# ----------------------------------------------------------------------- 5. report
echo
echo "=== state ==="
if [ "$INIT" = systemd ]; then
  printf 'earlyoom          : %s\n' "$(systemctl is-active earlyoom.service)"
  printf 'oom-notify        : %s\n' "$(systemctl --user is-active oom-notify.service 2>/dev/null || echo inactive)"
  printf 'system.slice min  : %s\n' "$(systemctl show system.slice -p MemoryMin --value)"
  printf 'user@1000 oomadj  : %s (was 100 from upstream)\n' "$(systemctl show user@1000.service -p OOMScoreAdjust --value)"
else
  printf 'earlyoom          : %s\n' "$($SUDO sv status earlyoom 2>&1 || echo 'not supervised')"
  printf 'earlyoom argv     : %s\n' "$(pgrep -a earlyoom | head -1 || echo 'not running')"
  printf 'oom-notify        : %s\n' "$(pgrep -x oom-notify >/dev/null && echo running || echo 'not running')"
  printf 'dmesg readable    : %s (needed for kernel-OOM notifications)\n' \
    "$(dmesg >/dev/null 2>&1 && echo yes || echo 'NO — kernel.dmesg_restrict still 1')"
  printf 'memory floors     : n/a on runit (no cgroup-managed services) — see header\n'
fi
printf 'swap              : %s\n' "$(swapon --show=NAME,SIZE,PRIO --noheadings | tr '\n' ';' || echo none)"
printf 'min_free_kbytes   : %s (set by packages/zram)\n' "$(sysctl -n vm.min_free_kbytes)"
echo
echo "Test the notification path without causing a real OOM:"
if [ "$INIT" = systemd ]; then
  echo "  systemd-cat -t kernel echo 'Out of memory: Killed process 1 (canary)'"
  echo "(the running user@1000 keeps OOMScoreAdjust=100 until the next login/reboot)"
else
  echo "  echo 'sending SIGTERM to process 1 uid 1000 \"canary\": badness 0' | sudo tee -a /var/log/earlyoom/current"
fi
