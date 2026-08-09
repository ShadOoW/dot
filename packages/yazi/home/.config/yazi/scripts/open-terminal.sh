#!/bin/bash
# Stash the yazi scratchpad then open a kitty terminal in DIR ($1) or CWD.
# Unset KITTY_LISTEN_ON so kitty spawns a separate process, not a window
# inside the yazi-explorer container (which would cause sway to un-hide it).
DIR="${1:-.}"
swaymsg '[app_id=yazi-explorer] move scratchpad' 2>/dev/null
nohup env -u KITTY_LISTEN_ON kitty --single-instance --working-directory "$DIR" -- "${SHELL:-bash}" >/dev/null 2>&1 &
