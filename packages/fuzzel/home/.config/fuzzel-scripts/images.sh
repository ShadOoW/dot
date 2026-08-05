#!/usr/bin/env bash
if pgrep -x fuzzel &>/dev/null; then
  pkill -x fuzzel || true
  exit 0
fi

SCREENS_DIR="/data/stash/clipboard/screens"

entries=$(ls -r "$SCREENS_DIR"/screenshot-*.png 2>/dev/null | xargs -n1 basename)
[[ -z "$entries" ]] && exit 0

selected=$(
  printf '%s\n' "$entries" | fuzzel --dmenu \
    --prompt="  " \
    --width=72 \
    --lines=16 \
    --no-sort \
    --no-run-if-empty
) || true

[[ -z "$selected" ]] && exit 0

filepath="$SCREENS_DIR/$selected"
[[ -f "$filepath" ]] || exit 0

wl-copy <"$filepath"
swayimg "$filepath" &
