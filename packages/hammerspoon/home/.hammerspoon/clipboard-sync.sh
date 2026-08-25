#!/bin/sh
# Mac -> Linux clipboard sync. Pushes every Mac copy into the desktop's cliphist history
# so it shows up under `mod+c` like a local copy. Driven by init.lua's changeCount poll.
#
# WHY A SPOOL FILE, and why the bytes never touch Lua: routing clipboard text through
# hs.task:setInput() re-decodes UTF-8 as MacRoman — measured, "✓ café" arrived as
# "‚úì caf√©". Here pbpaste writes the file and the shell feeds it to ssh, so the bytes
# are never seen by Hammerspoon. The spool also makes the sync durable: a copy made while
# the desktop is unreachable (asleep, no network) stays queued and lands on a later flush
# instead of being silently lost.
#
# WHY -max-items IS MANDATORY HERE: `cliphist store` TRIMS the db to -max-items on every
# single store and the CLI default is 750. That database is kept forever (~8.5k entries),
# so omitting the flag would destroy everything past the newest 750. The dot package
# `cliphist` also pins it in ~/.config/cliphist/config on the desktop; this flag is the
# belt to that braces, so the push stays safe even if the config is ever unlinked.
# Both values must move together — see packages/cliphist/README.md.
set -u

SPOOL="${CLIP_SPOOL:-$HOME/.cache/clipboard-sync}"
DEST="${CLIP_DEST:-desktop}"
DB="${CLIP_DB:-/data/stash/clipboard/cliphist}"
MAX_ITEMS="${CLIP_MAX_ITEMS:-1000000}"
CLIPHIST="${CLIP_BIN:-/usr/sbin/cliphist}"

mkdir -p "$SPOOL" || exit 1

# Snapshot the current pasteboard into the spool. An empty result means the pasteboard
# holds something pbpaste cannot render as text (an image, a file promise) — skipped on
# purpose rather than pushed as an empty clip.
capture() {
  tmp="$SPOOL/.incoming.$$"
  /usr/bin/pbpaste >"$tmp" 2>/dev/null
  if [ -s "$tmp" ]; then
    mv "$tmp" "$SPOOL/$(date +%s)-$$.clip"
  else
    rm -f "$tmp"
  fi
}

# Oldest first, delete only on a confirmed store. Stops at the first failure so the
# queue keeps its order and nothing is dropped on a half-open network.
flush() {
  for f in "$SPOOL"/*.clip; do
    [ -e "$f" ] || continue
    if /usr/bin/ssh -o BatchMode=yes -o ConnectTimeout=8 "$DEST" \
      "$CLIPHIST -db-path $DB -max-items $MAX_ITEMS store" <"$f"; then
      rm -f "$f"
    else
      return 1
    fi
  done
  return 0
}

case "${1:-sync}" in
  capture) capture ;;
  flush) flush ;;
  sync)
    capture
    flush
    ;;
  *)
    echo "usage: clipboard-sync.sh [sync|capture|flush]" >&2
    exit 2
    ;;
esac
