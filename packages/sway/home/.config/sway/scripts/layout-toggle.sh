#!/bin/bash
# Usage: layout-toggle.sh tabs|split
#
#   tabs   $mod+s        tabbed -> stacking, anything else -> tabbed
#   split  $mod+Shift+s  `layout toggle split`
#
# Both act on the container the focused window is visibly grouped in, which is not always
# its parent. autotiling (workspaces 5-10, see ../exec) runs `splith`/`splitv` on a window
# it focuses whenever the window's parent has the other orientation, and when the window
# has siblings sway answers that by wrapping it in a one-child split container of its own.
# A plain `layout tabbed` applies to the parent, which there is that wrapper, so it built a
# tab bar around one window and never grouped its siblings.
#
# So climb past one-child split containers to the first ancestor that groups something.
# Tabbed/stacked ancestors are taken even with a single child: they have a tab bar to
# toggle, and a workspace is the ceiling. `layout` always applies to the parent of the
# container it runs on, so the command is aimed at the child of that ancestor lying on the
# focus path. A focused floating window has no tiling parent: sway refuses the command
# ("Unable to change layout of floating windows"), so it is a no-op here.
#
# Then the group is cleaned of one-child containers, directly below it and directly above
# it, with `split none`. Climbing alone was not enough, because the wrappers stay put:
#   - below: a wrapper that ends up as a tab makes the tab read "V[kitty]", and a window
#     opened from that tab lands inside the wrapper — split within the tab, not a new tab.
#   - above: `layout` on a workspace makes sway wrap all of its children in a new container.
#     Toggled back to split, that wrapper stays as the workspace's only child; once windows
#     close down to one, the climb reaches the workspace through it, and the next mod+s wraps
#     it again — a one-tab bar across the whole workspace, "H[V[element H[kitty]] …]", with
#     every later window nested inside that single tab.
#
# `[con_id=X] split none` is container_flatten(parent of X), which does not stop at one
# level: it keeps replacing each ancestor that has a single child by that child, up to the
# first one with siblings or the workspace. So it is issued once per run of wrappers, and
# never where the run would continue into the group itself — a group of one window (a
# one-tab container, or a workspace holding one chain) is instead rebuilt at the window: its
# own parent takes the layout, then everything one-child above that parent is flattened.
set -eu

case "${1:-}" in
  tabs | split) MODE=$1 ;;
  *)
    echo "usage: ${0##*/} tabs|split" >&2
    exit 2
    ;;
esac

# The whole sway command, ";"-separated: the layout change, then the flattening. A focused
# empty workspace gets a bare `layout`, which sets what new windows open in. Nothing for
# floating focus. Container IDs are stable across the layout change, including when sway
# wraps a workspace's children, so the flattening can be planned from the tree read before.
CMD=$(swaymsg -t get_tree | jq -r --arg mode "$MODE" '
  def chain:
    if .focused then [.]
    else (((.nodes // []) + (.floating_nodes // []))[] | chain) as $rest | [.] + $rest
    end;
  def next_layout($layout):
    if $mode == "split" then "layout toggle split"
    elif $layout == "tabbed" then "layout stacking"
    else "layout tabbed"
    end;
  def wrapper: .type == "con" and (.nodes | length) == 1;
  # The first node under a run of one-child containers starting at this one.
  def bottom: if wrapper then .nodes[0] | bottom else . end;
  def unsplit($id): "[con_id=\($id)] split none";
  (first(chain) // [] | reverse) as $c
  | def pick($i):
      $c[$i] as $C | $c[$i + 1] as $A
      | if $A == null or $C.type == "floating_con" then empty
        elif $C.type == "workspace" then next_layout($C.layout)
        elif ($A.nodes | length) > 1 then
          ["[con_id=\($C.id)] \(next_layout($A.layout))"]
          + [$A.nodes[] | select(wrapper) | bottom | unsplit(.id)]
          + (if $c[$i + 2] | wrapper then [unsplit($A.id)] else [] end)
          | join("; ")
        elif $A.type == "workspace" or $A.type == "floating_con"
          or ($A.layout | IN("tabbed", "stacked")) then
          "[con_id=\($c[0].id)] \(next_layout($A.layout))"
          + (if $c[2] | wrapper then "; \(unsplit($c[1].id))" else "" end)
        else pick($i + 1)
        end;
    pick(0)
')

[ -n "$CMD" ] || exit 0
swaymsg -q "$CMD"
