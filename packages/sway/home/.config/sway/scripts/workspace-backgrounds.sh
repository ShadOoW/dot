#!/bin/bash
# Random animated background using mpvpaper
#
# Two ways in. sway's `exec_always` runs it bare: mpvpaper forks (-f) and the
# script exits, which is what the Arch and Void boxes do. `--foreground` is for
# a supervisor — the NixOS desk's wallpaper.service — which needs mpvpaper to
# BE the process it watches, so its memory cap and restart policy apply to it.

VIDEOS_DIR=~/.config/sway/backgrounds

fork=(-f)
[ "${1:-}" = --foreground ] && fork=()

# Kill existing mpvpaper
pkill -f "mpvpaper" 2>/dev/null || true
sleep 0.3

# Get current output (fallback to first available if none focused)
OUTPUT=$(swaymsg -t get_outputs | jq -r '.[0].name')

# Get mp4 files
shopt -s nullglob
mp4_files=("$VIDEOS_DIR"/*.mp4)
shopt -u nullglob

if [ ${#mp4_files[@]} -eq 0 ]; then
  exit 0
fi

# Pick random
random_index=$((RANDOM % ${#mp4_files[@]}))
random_video="${mp4_files[$random_index]}"

# Start mpvpaper
exec mpvpaper "${fork[@]}" -o "fps=24 no-audio loop" "$OUTPUT" "$random_video"
