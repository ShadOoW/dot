#!/bin/bash
# Open a new kitty in the focused terminal's actual cwd (falls back to $HOME).
# Previously used $PWD, which is sway's environment (your home dir), not the
# focused terminal — so it never opened where you were.
dir=$(~/.config/sway/scripts/kitty-focused-cwd.sh 2>/dev/null) || dir="$HOME"
kitty --directory="$dir"
