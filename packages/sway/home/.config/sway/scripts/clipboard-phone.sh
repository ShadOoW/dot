#!/usr/bin/env bash
# Clipboard bridge to the phone. On-demand only — no daemon and no polling, so nothing
# touches the phone's radio unless a keybinding fires.
#
# push works with no root. pull does NOT: since Android 10 only the foreground app or the
# active keyboard may READ the clipboard, so termux-clipboard-get returns EMPTY (rc=0, no
# error) until READ_CLIPBOARD is granted to Termux. That silent-empty is why pull refuses to
# write rather than piping nothing into wl-copy and wiping the desktop clipboard.
set -uo pipefail

HOSTS=(phone phone-tail) # LAN first, then tailnet — ssh_config aliases
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=3)

note() { notify-send "clipboard" "$1"; }
die() {
  notify-send -u critical "clipboard" "$1"
  exit 1
}

case "${1:-}" in
  push)
    # Buffered before the loop: stdin can only be consumed once, so a LAN attempt that
    # fails mid-transfer must not leave the tailnet retry with an empty pipe.
    content=$(wl-paste --no-newline --type text/plain 2>/dev/null) || true
    [[ -n "$content" ]] || die "nothing text-like in the clipboard"
    for h in "${HOSTS[@]}"; do
      # Content goes over stdin, never argv — argv is world-readable via ps.
      printf '%s' "$content" | ssh "${SSH_OPTS[@]}" "$h" termux-clipboard-set
      rc=$?
      [[ $rc -eq 255 ]] && continue # ssh transport failed — try the next path
      [[ $rc -eq 0 ]] || die "termux-clipboard-set failed on $h (rc=$rc)"
      note "sent → phone ($h)"
      exit 0
    done
    die "phone unreachable on LAN or tailnet"
    ;;
  pull)
    for h in "${HOSTS[@]}"; do
      content=$(ssh "${SSH_OPTS[@]}" "$h" termux-clipboard-get)
      rc=$?
      [[ $rc -eq 255 ]] && continue
      [[ $rc -eq 0 ]] || die "termux-clipboard-get failed on $h (rc=$rc)"
      [[ -n "$content" ]] || die "phone returned empty — READ_CLIPBOARD not granted to Termux"
      printf '%s' "$content" | wl-copy
      note "pulled ← phone ($h)"
      exit 0
    done
    die "phone unreachable on LAN or tailnet"
    ;;
  *)
    printf 'usage: %s {push|pull}\n' "${0##*/}" >&2
    exit 2
    ;;
esac
