#!/bin/bash
# Random animated background using mpvpaper

VIDEOS_DIR=~/.config/sway/backgrounds

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
mpvpaper -f -o "fps=24 no-audio loop" "$OUTPUT" "$random_video"
