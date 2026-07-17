#!/bin/bash
# Copy the cwd of the currently focused kitty window to the Wayland clipboard.
set -euo pipefail

dir=$(~/.config/sway/scripts/kitty-focused-cwd.sh) || {
  notify-send -u low "Copy cwd" "No focused kitty terminal"
  exit 1
}

# No trailing newline: keeps the path clean for pasting into other terminals.
printf '%s' "$dir" | wl-copy
notify-send -u low "Copied cwd" "$dir"
