#!/bin/bash
# Print the cwd of the currently focused kitty window.
# Exits non-zero if the focused sway window isn't a kitty with remote control.
#
# How it works: kitty's `listen_on unix:/tmp/kitty` auto-appends the instance
# PID, giving one control socket per kitty instance at /tmp/kitty-<pid>. That
# PID is the same one sway reports for the focused window, so we can talk to
# exactly the focused terminal without guessing.
set -euo pipefail

pid=$(swaymsg -t get_tree | jq -r 'recurse(.nodes[]?, .floating_nodes[]?)
  | select(.focused == true) | .pid')

sock="/tmp/kitty-$pid"
[[ -n "$pid" && "$pid" != "null" && -S "$sock" ]] || exit 1

kitty @ --to "unix:$sock" ls | jq -r '
  first(.[] | select(.is_focused).tabs[] | select(.is_focused).windows[]
        | select(.is_focused) | .foreground_processes[0].cwd // .cwd)'
