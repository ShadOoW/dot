#!/bin/bash
set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO="sudo"

fc-cache -fv

# /etc/vconsole.conf must be a REAL FILE, never a `dot link` symlink into /data.
# systemd-vconsole-setup runs at sysinit, ~1s before data.mount, so a symlink is
# unreadable at that point and FONT is silently never applied — the console just
# keeps the default font and the only clue is
#   systemd-vconsole-setup: Configuration of first virtual console was skipped
# Same class of bug as zram; see packages/zram/configure.sh and the "Early boot"
# section of /data/ops/CLAUDE.md.
#
# It lives under etc-real/ rather than system/ ON PURPOSE: dot's linker only walks home/
# and system/ (src/lib/pkg.ts collectFiles), so `dot link fonts` cannot recreate the
# symlink that made FONT silently never apply.
src="$DIR/etc-real/etc/vconsole.conf"
dst=/etc/vconsole.conf
if [ -f "$src" ]; then
  if [ -L "$dst" ] || ! cmp -s "$src" "$dst"; then
    $SUDO rm -f "$dst" # rm first, else we write *through* the symlink
    $SUDO install -m644 "$src" "$dst"
    echo "installed real file: $dst"
  else
    echo "ok: $dst"
  fi
  [ -L "$dst" ] && {
    echo "still a symlink: $dst" >&2
    exit 1
  }
  # Apply now so you do not have to reboot to see it.
  font=$(sed -n 's/^FONT=//p' "$dst" | tr -d '"')
  [ -n "$font" ] && $SUDO setfont "$font" 2>/dev/null || true
fi
