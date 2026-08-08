#!/bin/bash
# Usage: toggle-scratchpad.sh <mark_name> <selector_type> <selector_value> [command]
#
#   mark_name       sway mark to toggle (terminal, music, explorer, btw)
#   selector_type   app_id | class | instance
#   selector_value  value of that selector (e.g. terminal-mark)
#   command         how to launch the app if no window exists yet
#
# Hides the window when it is visible; shows it and re-applies geometry when it is hidden;
# launches it when it does not exist at all.
#
# Three failure modes this script exists to avoid. All three were live bugs on Void, and all
# three were invisible because every one of them fails as a *silent no-op*:
#
# 1. LAUNCH RACE. The old version did `eval "$COMMAND" &` then `sleep 0.3`, then issued
#    `scratchpad show` + geometry. Measured kitty map latency on this box is ~0.53s warm, so
#    every one of those four commands landed on `"error": "No matching node."` and the window
#    kept whatever default geometry it was mapped with. Arch hid this because kitty starts
#    faster there; on Void, kitty additionally probes a missing libsystemd.so and waits on an
#    xdg-desktop-portal name that is not provided, both visible on its stderr. Fixed by
#    polling the tree until the window actually exists instead of guessing a delay.
#
# 2. MARK THEFT -> orphaned windows. Sway marks are unique: `mark X` moves X off whatever
#    held it. When the race above made the "is it running" probe read 0 while the pre-warmed
#    window from sway's `exec` block was still starting, this script launched a SECOND copy;
#    whichever mapped last took the mark and the other was stranded — unmarked, invisible, in
#    the scratchpad, parked at the default centered position, for the rest of the session.
#    That orphan is what showed up as "mod+z opens the terminal in the middle of the screen
#    the first time, correctly at the bottom the next time". Fixed by adopting an existing
#    window that matches the selector but has lost (or never got) the mark, rather than
#    launching a duplicate.
#
# 3. ppt GEOMETRY ON A HIDDEN CONTAINER. sway refuses it outright:
#      "Cannot resize a hidden scratchpad container by ppt"
#    so `resize set ...ppt` MUST come after `scratchpad show`, never before it and never in
#    the same breath as the launch. This is why a half-applied chain left the music window at
#    full width: the resize errored and only the move survived.
set -u

MARK_NAME=${1:-unknown}
SELECTOR_TYPE=${2:-app_id}
SELECTOR_VALUE=${3:-unknown-mark}
COMMAND=${4:-}

# Seconds to wait for a freshly launched client to appear in the tree. Generous on purpose:
# waiting is free (the loop exits the moment the window lands) whereas being too early is the
# bug above. Override with SCRATCHPAD_LAUNCH_TIMEOUT for a pathologically slow client.
LAUNCH_TIMEOUT=${SCRATCHPAD_LAUNCH_TIMEOUT:-8}

# jq path for the selector. Wayland clients expose app_id at the top level; XWayland clients
# carry class/instance under window_properties, so these are not interchangeable.
case "$SELECTOR_TYPE" in
  app_id) SELECTOR_PATH='.app_id?' ;;
  class) SELECTOR_PATH='.window_properties?.class?' ;;
  instance) SELECTOR_PATH='.window_properties?.instance?' ;;
  *)
    echo "toggle-scratchpad: unknown selector type '$SELECTOR_TYPE'" >&2
    exit 1
    ;;
esac

# `index` returns null when absent but 0 for the first element, and 0 is truthy in jq — so
# the test has to be against null explicitly, not a bare truthiness check.
HAS_MARK="((.marks? // []) | index(\"$MARK_NAME\")) != null"

count_marked() {
  swaymsg -t get_tree | jq "[.. | objects | select($HAS_MARK)] | length"
}

count_marked_visible() {
  swaymsg -t get_tree | jq "[.. | objects | select($HAS_MARK and .visible == true)] | length"
}

# con_id of an existing window matching the selector, mark or no mark. Empty when none.
matching_id() {
  swaymsg -t get_tree |
    jq -r "[.. | objects | select($SELECTOR_PATH == \"$SELECTOR_VALUE\") | .id] | first // empty"
}

# Only ever called on a container that is already visible — see failure mode 3.
apply_geometry() {
  case "$MARK_NAME" in
    terminal)
      swaymsg "[con_mark=\"$MARK_NAME\"] resize set width 100ppt height 40ppt, move position 0 60ppt"
      ;;
    music)
      # Previously ended with `move to 0 15`, which is not a sway command — it failed with a
      # parse error on every single invocation, so `move position center` was always the
      # effective placement. Dropped rather than "fixed": centered is the behaviour this
      # window has actually had all along.
      swaymsg "[con_mark=\"$MARK_NAME\"] resize set width 60ppt height 40ppt, move position center"
      ;;
    explorer)
      swaymsg "[con_mark=\"$MARK_NAME\"] resize set width 100ppt height 50ppt, move position center"
      ;;
    btw)
      swaymsg "[con_mark=\"$MARK_NAME\"] resize set width 60ppt height 45ppt, move position center"
      ;;
  esac
}

show_and_place() {
  swaymsg "[con_mark=\"$MARK_NAME\"] scratchpad show" >/dev/null
  apply_geometry >/dev/null
}

# --- already marked: plain toggle -------------------------------------------------------
if [ "$(count_marked)" -gt 0 ]; then
  if [ "$(count_marked_visible)" -gt 0 ]; then
    # Visible -> `scratchpad show` stashes it again. No geometry: it is going away.
    swaymsg "[con_mark=\"$MARK_NAME\"] scratchpad show" >/dev/null
  else
    show_and_place
  fi
  exit 0
fi

# --- unmarked window already exists: adopt it, never launch a second one ----------------
id=$(matching_id)

if [ -z "$id" ]; then
  if [ -z "$COMMAND" ]; then
    echo "toggle-scratchpad: no window for mark '$MARK_NAME' and no command to launch" >&2
    exit 1
  fi

  eval "$COMMAND" &

  deadline=$((SECONDS + LAUNCH_TIMEOUT))
  while :; do
    id=$(matching_id)
    [ -n "$id" ] && break
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "toggle-scratchpad: '$SELECTOR_VALUE' did not appear within ${LAUNCH_TIMEOUT}s" >&2
      exit 1
    fi
    sleep 0.05
  done
fi

# The for_window rules in rules.conf normally mark and stash the window at map time. Assert
# both anyway: this path also covers a window that was orphaned by an older mark theft, and
# re-issuing is idempotent. Bare `mark` (not --add) is what pulls the mark back off any other
# container still holding it.
if [ "$(count_marked)" -eq 0 ]; then
  swaymsg "[con_id=$id] mark \"$MARK_NAME\"" >/dev/null
fi
swaymsg "[con_id=$id] move scratchpad" >/dev/null
show_and_place
