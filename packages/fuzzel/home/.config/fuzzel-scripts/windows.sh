#!/usr/bin/env bash
set -euo pipefail

pkill -x fuzzel && exit 0

get_pwa_name() {
  local app_id="$1"
  local app_dir="${XDG_DATA_HOME:-$HOME/.local/share}/applications"

  if [[ "$app_id" == vivaldi-*-Default ]]; then
    local app_id_short
    app_id_short=$(echo "$app_id" | sed 's/vivaldi-\(.*\)-Default/\1/')
    local f
    for f in "$app_dir"/vivaldi-*-Default.desktop; do
      [[ -f "$f" ]] || continue
      if grep -q "app-id=$app_id_short" "$f" 2>/dev/null; then
        local name
        name=$(grep -E '^Name=' "$f" 2>/dev/null | head -1 | cut -d= -f2-)
        [[ -n "$name" ]] && echo "$name" && return
      fi
    done
  fi
  echo "$app_id"
}

format_ws() {
  local ws="$1"
  if [[ "$ws" =~ ^[0-9]+$ ]]; then
    echo $((ws % 10))
  else
    echo "$ws"
  fi
}

build_list() {
  swaymsg -t get_tree | jq -r '
    [.nodes[].nodes[] | select(.type == "workspace") as $ws
    | recurse(.nodes[]?, .floating_nodes[]?)
    | select(.type == "con" or .type == "floating_con")
    | select(.app_id != null)
    | select(.id != null)
    | select($ws.name != "__i3_scratch")
    | "\($ws.name)|\(.id)|\(.app_id)|\(.name)"
    ] | .[]
  ' | while IFS='|' read -r ws id app_id name; do
    local display_name ws_display
    display_name=$(get_pwa_name "$app_id")
    ws_display=$(format_ws "$ws")
    echo "$ws_display $display_name - $name"
  done
}

list=$(build_list)
selected=$(echo "$list" | fuzzel --dmenu --prompt="  " --lines=10)

[[ -z "$selected" ]] && exit 0

title="${selected##* - }"

found_id=$(swaymsg -t get_tree | jq -r '
  first(
    [.nodes[].nodes[] | select(.type == "workspace")
    | recurse(.nodes[]?, .floating_nodes[]?)
    | select(.type == "con" or .type == "floating_con")
    | select(.name == "'"$title"'")
    | .id] | .[0]
  ) // empty
')

[[ -n "$found_id" ]] && swaymsg "[con_id=$found_id] focus" >/dev/null 2>&1
