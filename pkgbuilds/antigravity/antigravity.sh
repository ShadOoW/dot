#!/bin/bash
XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"

if [[ -f "$XDG_CONFIG_HOME/antigravity-flags.conf" ]]; then
  ANTIGRAVITY_USER_FLAGS="$(sed 's/#.*//' "$XDG_CONFIG_HOME/antigravity-flags.conf" | tr '\n' ' ')"
fi

exec /opt/Antigravity-x64/antigravity "$@" ${ANTIGRAVITY_USER_FLAGS:-}
