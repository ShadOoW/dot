#!/bin/bash
# Usage: layout-toggle.sh tabs|split
#
#   tabs   $mod+s        tabbed -> stacking, anything else -> tabbed
#   split  $mod+Shift+s  `layout toggle split`
#
# Both act on the container the focused window is visibly grouped in, which is not always
# its parent. autotiling-rs (workspaces 5-10, see ../exec) runs `splith`/`splitv` on every
# window it focuses, and sway answers that by wrapping the window in a one-child split
# container of its own. v0.1.8 even does it inside tabbed and stacked containers: it tests
# the focused leaf's layout for tabbed/stacked, and a leaf's layout is always `none`
# (upstream issue #15, PR #29). A plain `layout tabbed` applies to the parent, which there
# is that wrapper, so mod+s built a tab bar around one window and never grouped its
# siblings; mod+Shift+s flipped the orientation of a box with nothing else in it.
#
# So climb past one-child split containers to the first ancestor that groups something.
# Tabbed/stacked ancestors are taken even with a single child: they have a tab bar to
# toggle, and a workspace is the ceiling. `layout` always applies to the parent of the
# container it runs on, so the command is aimed at the child of that ancestor lying on the
# focus path. A focused floating window has no tiling parent: sway refuses the command
# ("Unable to change layout of floating windows"), so it is a no-op here.
set -eu

case "${1:-}" in
  tabs | split) MODE=$1 ;;
  *)
    echo "usage: ${0##*/} tabs|split" >&2
    exit 2
    ;;
esac

# Prints "<con_id> <ancestor layout>", or "- <layout>" for a focused (empty) workspace,
# which takes a bare `layout` to set what new windows open in. Nothing for floating focus.
TARGET=$(swaymsg -t get_tree | jq -r '
  def chain:
    if .focused then [.]
    else (((.nodes // []) + (.floating_nodes // []))[] | chain) as $rest | [.] + $rest
    end;
  (first(chain) // [] | reverse) as $c
  | def pick($i):
      $c[$i] as $C | $c[$i + 1] as $A
      | if $A == null or $C.type == "floating_con" then empty
        elif $C.type == "workspace" then "- \($C.layout)"
        elif $A.type == "workspace" or $A.type == "floating_con"
          or ($A.layout | IN("tabbed", "stacked"))
          or ($A.nodes | length) > 1 then "\($C.id) \($A.layout)"
        else pick($i + 1)
        end;
    pick(0)
')

[ -n "$TARGET" ] || exit 0
read -r CON_ID LAYOUT <<<"$TARGET"

if [ "$MODE" = tabs ]; then
  if [ "$LAYOUT" = tabbed ]; then CMD="layout stacking"; else CMD="layout tabbed"; fi
else
  CMD="layout toggle split"
fi

if [ "$CON_ID" = - ]; then
  swaymsg -q "$CMD"
else
  swaymsg -q "[con_id=$CON_ID] $CMD"
fi
