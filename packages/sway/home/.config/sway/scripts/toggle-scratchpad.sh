#!/bin/bash

# Usage: toggle-scratchpad.sh [mark_name] [app_id_type] [app_id] [command]
#
# mark_name:   Name for the mark (e.g., terminal, music, explorer)
# app_id_type: Type of selector to use (app_id, class, or instance)
# app_id:      Value of the selector (e.g., terminal-mark, music-mark, explorer-mark)
# command:     Command to launch the application

MARK_NAME=${1:-"unknown"}
APP_ID_TYPE=${2:-"app_id"}
APP_ID=${3:-"unknown-mark"}
COMMAND=${4:-""}

SCRIPTS_DIR="$(dirname "$0")"

set_window_properties() {
  case "$MARK_NAME" in
    "terminal")
      swaymsg "[con_mark=\"$MARK_NAME\"] resize set width 100ppt height 40ppt, move position 0 60ppt"
      ;;
    "music")
      swaymsg "[con_mark=\"$MARK_NAME\"] resize set width 60ppt height 40ppt, move position center, move to 0 15"
      ;;
    "explorer")
      swaymsg "[con_mark=\"$MARK_NAME\"] resize set width 100ppt height 50ppt, move position center"
      ;;
    "btw")
      swaymsg "[con_mark=\"$MARK_NAME\"] resize set width 60ppt height 45ppt, move position center"
      ;;
  esac
}

is_running=$(swaymsg -t get_tree | jq "[ .. | objects | select(.marks? != null and (.marks | index(\"$MARK_NAME\"))) ] | length")

if [ "$is_running" -gt 0 ]; then
  # Check if window is currently visible (shown) or hidden (in scratchpad)
  is_shown=$(swaymsg -t get_tree | jq "[ .. | objects | select(.marks? != null and (.marks | index(\"$MARK_NAME\")) and .visible == true) ] | length")

  swaymsg "[con_mark=\"$MARK_NAME\"] scratchpad show"

  # Only apply geometry when showing — move position center requires a visible window
  if [ "$is_shown" -eq 0 ]; then
    set_window_properties
  fi
else
  if [ -z "$COMMAND" ]; then
    echo "Error: No command provided to launch application"
    exit 1
  fi

  # Launch application - for_window rules handle mark + move scratchpad
  eval "$COMMAND" &

  # Wait for window to appear - simple delay is sufficient
  sleep 0.3

  # Show immediately
  swaymsg "[con_mark=\"$MARK_NAME\"] scratchpad show"
  set_window_properties
fi
