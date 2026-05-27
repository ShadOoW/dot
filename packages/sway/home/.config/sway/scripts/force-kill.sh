#!/usr/bin/env bash
pid=$(swaymsg -t get_tree | jq 'first(.. | select(.pid? and (.focused? == true)) | .pid)')
[ -n "$pid" ] && [ "$pid" != "null" ] && kill -9 "$pid"
