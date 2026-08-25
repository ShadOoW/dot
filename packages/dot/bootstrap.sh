#!/usr/bin/env sh
# Record where this host keeps the kit, so the launcher can find the CLI.
#
# Plain sh and no dependency on `dot`, because on a fresh host `dot` is exactly what does not
# work yet: this repo is the payload, the TypeScript lives in the kit, and nothing in either
# tree knows where the other was cloned. That is the one fact per host this writes down.
#
# Usage:
#
#     packages/dot/bootstrap.sh /data/code/fleet     # desktop
#     packages/dot/bootstrap.sh ~/code/fleet         # laptop
#
# Then `dot pkg dot link` puts the launcher on PATH.
set -eu

if [ $# -ne 1 ]; then
  echo "usage: $0 <path-to-fleet-checkout>" >&2
  exit 2
fi

fleet=$(cd "$1" 2>/dev/null && pwd -P) || {
  echo "bootstrap: $1 is not a directory" >&2
  exit 2
}

cli="$fleet/apps/dot/dot.ts"
if [ ! -f "$cli" ]; then
  echo "bootstrap: $cli is not there — is $fleet a fleet checkout?" >&2
  exit 2
fi

# Refuse a checkout whose dependencies are not installed. Without this the first thing the
# operator sees is a module-resolution stack from inside effect, which reads as a broken CLI
# rather than as a missing `bun install`.
if [ ! -d "$fleet/node_modules/effect" ]; then
  echo "bootstrap: $fleet has no node_modules/effect." >&2
  echo "           run: cd $fleet && bun install --filter '@app/dot' --filter '@kit/*'" >&2
  exit 2
fi

state="${XDG_STATE_HOME:-$HOME/.local/state}/dot"
mkdir -p "$state"
printf '%s\n' "$cli" >"$state/cli-path"

echo "dot: kit recorded — $cli"
