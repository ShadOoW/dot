#!/usr/bin/env bash
DELETE_MODE="${1:-}"

if pgrep -x fuzzel &>/dev/null; then
  pkill -x fuzzel || true
  exit 0
fi

DB="/data/stash/clipboard/cliphist"

if [[ "$DELETE_MODE" == "--delete" ]]; then
  prompt="󰆴  "
else
  prompt="  "
fi

selected=$(
  cliphist -db-path "$DB" list | fuzzel --dmenu \
    --prompt="$prompt" \
    --width=72 \
    --lines=16 \
    --no-sort \
    --no-run-if-empty
) || true

[[ -z "$selected" ]] && exit 0

if [[ "$DELETE_MODE" == "--delete" ]]; then
  cliphist -db-path "$DB" delete <<<"$selected"
else
  cliphist -db-path "$DB" decode <<<"$selected" | wl-copy
fi
