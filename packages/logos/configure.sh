#!/usr/bin/env sh
# `dot pkg logos configure` — keeps the command links in `~/.local/bin` matching the
# workspace manifests: one per declared `bin` entry, pruning any this step no longer wants
# (logos 13 §9.5). Run after adding, removing or moving a command's declaration.
set -eu

state="${XDG_STATE_HOME:-$HOME/.local/state}/dot"
record="$state/logos-root"

root="${LOGOS_ROOT:-}"
if [ -n "$root" ]; then
  remedy="unset LOGOS_ROOT, or point it at a logos checkout"
else
  remedy="re-run \$payload/packages/dot/bootstrap.sh /path/to/logos"
  if [ -f "$record" ]; then
    root=$(cat "$record")
  fi
fi

if [ -z "$root" ]; then
  echo "configure: this host has no logos checkout recorded at $record." >&2
  echo "           run packages/dot/bootstrap.sh /path/to/logos" >&2
  exit 2
fi

if [ ! -d "$root" ]; then
  echo "configure: ${LOGOS_ROOT:+LOGOS_ROOT }${LOGOS_ROOT:-$record} names $root, which is not there." >&2
  echo "           $remedy" >&2
  exit 2
fi

exec bun "$root/tooling/launcher/link.ts" --root "$root" --launcher "$HOME/.local/libexec/launcher" --into "$HOME/.local/bin"
