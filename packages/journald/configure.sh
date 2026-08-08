#!/usr/bin/env bash
# Cap journald's disk usage.
#
# Files live under etc-real/ (real copies, not `dot link` symlinks) because systemd-journald
# starts very early — well before /data is mounted — so a symlinked drop-in would be
# unreadable exactly when it is needed. Same hazard as packages/zram; dot's linker only walks
# home/ and system/, so etc-real/ cannot be symlinked by accident.
# See /data/config/dot/AGENTS.md and the "Early boot" section of /data/ops/CLAUDE.md.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO="sudo"

# systemd-only: Void logs with socklog, not journald. meta.json cannot express "arch only"
# (the schema validates os against linux/macos/windows even though the linker would honour a
# distro value), so the gate lives here.
# /run/systemd/system, not /run/systemd: elogind creates the latter on Void for the logind
# API, so the bare check passed there and this script would have tried to configure journald
# on a box that has no journald. See packages/zram/configure.sh for the full write-up.
if [ ! -d /run/systemd/system ]; then
  echo "journald: systemd-only — Void uses socklog, nothing to do"
  exit 0
fi

echo "before: $(journalctl --disk-usage 2>&1 | tail -1)"

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

while IFS= read -r -d '' src; do
  install_real "$src" "${src#"$DIR/etc-real"}"
done < <(find "$DIR/etc-real" -type f -print0 | sort -z)

$SUDO systemctl restart systemd-journald.service

# Limits only apply as the journal rotates, so reclaim the existing excess now.
$SUDO journalctl --vacuum-size=1G
$SUDO journalctl --namespace=netdata --vacuum-size=256M 2>/dev/null || true

echo
echo "after:  $(journalctl --disk-usage 2>&1 | tail -1)"
