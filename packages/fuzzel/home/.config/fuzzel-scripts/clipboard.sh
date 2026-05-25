#!/usr/bin/env bash
DELETE_MODE="${1:-}"

if pgrep -x fuzzel &>/dev/null; then
  pkill -x fuzzel || true
  exit 0
fi

if [[ "$DELETE_MODE" == "--delete" ]]; then
  prompt="󰆴  "
else
  prompt="  "
fi

selected=$(
  cliphist list | fuzzel --dmenu \
    --prompt="$prompt" \
    --width=72 \
    --lines=16 \
    --no-sort \
    --no-run-if-empty
) || true

[[ -z "$selected" ]] && exit 0

if [[ "$DELETE_MODE" == "--delete" ]]; then
  cliphist delete <<<"$selected"
else
  cliphist decode <<<"$selected" | wl-copy
fi
