#!/bin/bash
# Stash the yazi scratchpad then open file(s) in nvim in a new kitty window.
# Unset KITTY_LISTEN_ON so kitty spawns a separate process, not a window
# inside the yazi-explorer container (which would cause sway to un-hide it).
swaymsg '[app_id=yazi-explorer] move scratchpad' 2>/dev/null
nohup env -u KITTY_LISTEN_ON kitty --single-instance -- nvim "$@" >/dev/null 2>&1 &
