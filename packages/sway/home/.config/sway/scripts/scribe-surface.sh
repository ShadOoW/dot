#!/bin/bash
# Usage: scribe-surface.sh [show|hide|toggle]
#
# Thin wrapper over toggle-scratchpad.sh for the scribe dictation scratchpad
# ($mod+Shift+t), adding the one thing the generic script must not know: how to reach
# sway when there is no session environment.
#
# The wake runit service runs as shad with no WAYLAND_DISPLAY/SWAYSOCK, so swaymsg
# cannot locate the socket on its own. Stale sockets from dead sessions linger in
# /run/user/<uid> — three were found on this host with only one live [2026-08-26] —
# so the first socket in glob order is not necessarily live: probe each until one
# answers. toggle-scratchpad.sh inherits SWAYSOCK through the exec and does the rest.
#
# show = summon the window (launching it on first use), hide = stash it, toggle = the
# keybinding behaviour. All three are no-ops when the requested state already holds,
# so wake can fire `show` on scribe open and `hide` on close without tracking state.
set -u

ACTION=${1:-toggle}

for sock in /run/user/"$(id -u)"/sway-ipc.*.sock; do
  [ -S "$sock" ] || continue
  if SWAYSOCK="$sock" swaymsg -t get_tree >/dev/null 2>&1; then
    export SWAYSOCK="$sock"
    break
  fi
done

if [ -z "${SWAYSOCK:-}" ]; then
  echo "scribe-surface: no live sway socket found" >&2
  exit 1
fi

exec ~/.config/sway/scripts/toggle-scratchpad.sh "$ACTION" scribe app_id scribe-scratch \
  'kitty --single-instance --app-id scribe-scratch bun /data/code/fleet/apps/scribe/run.ts'
