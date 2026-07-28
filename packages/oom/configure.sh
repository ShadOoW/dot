#!/usr/bin/env bash
# Memory safety, minimal edition. Three moving parts, no more:
#
#   1. earlyoom          — kills the largest offending PROCESS before the kernel's blunt
#                          last-resort OOM killer runs (which killed the session manager).
#   2. slice drop-ins    — reserve a floor of unreclaimable memory for system.slice, and
#                          undo upstream's OOMScoreAdjust=100 on user@.service.
#   3. oom-notify        — a user service that raises a red, non-expiring notification on
#                          any OOM kill (kernel, earlyoom, or systemd-oomd).
#
# Deliberately NOT enabling systemd-oomd: sway is started by ly rather than a systemd user
# session, so every GUI app shares ONE cgroup (session-c1.scope, ~15.3 GiB). oomd kills at
# cgroup granularity, so its only move would be killing the whole session — a logout.
# See etc-real/etc/systemd/system/earlyoom.service.d/10-args.conf for the full reasoning.
#
# The /etc files live under etc-real/ rather than system/ because unit drop-ins are read
# when systemd loads units at boot — before /data is mounted. dot's linker only walks home/
# and system/ (src/lib/pkg.ts collectFiles), so they physically cannot be symlinked.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO="sudo"

# Arch/systemd only — the drop-ins under etc-real/ are systemd unit config and the notifier
# is a systemd user service. meta.json pins os:["arch"] to match. Getting the same coverage
# on Void would mean an /etc/sv/earlyoom runit service plus a different notifier hookup;
# not done, because the desktop's day-to-day boot is Arch.
if [ ! -d /run/systemd ]; then
  echo "oom: systemd-only as written (Void would need an /etc/sv/earlyoom runit service)" >&2
  exit 0
fi

# ------------------------------------------------------------------- 1. the package
if ! command -v earlyoom >/dev/null 2>&1; then
  echo "installing earlyoom..."
  $SUDO pacman -S --needed --noconfirm earlyoom libnotify
fi

# --------------------------------------------------- 2. real files under /etc
install_real() {
  local src=$1 dst=$2
  if [ ! -L "$dst" ] && [ -f "$dst" ] && cmp -s "$src" "$dst"; then
    printf '  ok         %s\n' "$dst"
    return 0
  fi
  $SUDO rm -f "$dst" # rm first, else we write *through* a symlink
  $SUDO install -D -m644 "$src" "$dst"
  [ -L "$dst" ] && {
    echo "still a symlink: $dst" >&2
    exit 1
  }
  printf '  installed  %s\n' "$dst"
}

echo "installing systemd drop-ins (real files, never symlinks):"
while IFS= read -r -d '' src; do
  install_real "$src" "${src#"$DIR/etc-real"}"
done < <(find "$DIR/etc-real" -type f -print0 | sort -z)

$SUDO systemctl daemon-reload

# ------------------------------------------------------------------- 3. earlyoom
$SUDO systemctl enable --now earlyoom.service
# Prove the ExecStart override took, rather than assuming it did.
echo
echo "earlyoom argv now in effect:"
systemctl show earlyoom.service -p ExecStart --value | tr ' ' '\n' | grep -E '^(argv|-|\^)' | head -8 || true

# ------------------------------------------------------ 4. the notifier (user service)
# `dot link oom` must have run first so ~/.local/bin/oom-notify and the user unit exist.
if [ -x "$HOME/.local/bin/oom-notify" ]; then
  systemctl --user daemon-reload
  systemctl --user enable --now oom-notify.service
  echo "oom-notify: $(systemctl --user is-active oom-notify.service)"
else
  echo "NOTE: ~/.local/bin/oom-notify missing — run 'dot link oom' then re-run configure" >&2
fi

# ----------------------------------------------------------------------- 5. report
echo
echo "=== state ==="
printf 'earlyoom          : %s\n' "$(systemctl is-active earlyoom.service)"
printf 'oom-notify        : %s\n' "$(systemctl --user is-active oom-notify.service 2>/dev/null || echo inactive)"
printf 'system.slice min  : %s\n' "$(systemctl show system.slice -p MemoryMin --value)"
printf 'user@1000 oomadj  : %s (was 100 from upstream)\n' "$(systemctl show user@1000.service -p OOMScoreAdjust --value)"
printf 'swap              : %s\n' "$(swapon --show=NAME,SIZE,PRIO --noheadings | tr '\n' ';' || echo none)"
echo
echo "Test the notification path without causing a real OOM:"
echo "  systemd-cat -t kernel echo 'Out of memory: Killed process 1 (canary)'"
echo "(the running user@1000 keeps OOMScoreAdjust=100 until the next login/reboot)"
