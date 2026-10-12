#!/usr/bin/env sh
# Record where this host keeps the kit, link the shared launcher and create every command
# link — the one script that must work before any command exists.
#
# Plain sh and no dependency on `dot`, because on a fresh host `dot` is exactly what does not
# work yet: this repo is the payload, the TypeScript lives in the kit, and nothing in either
# tree knows where the other was cloned. That is the one fact per host this writes down —
# everything after it runs by path, for the same reason (logos 13).
#
# Usage:
#
#     packages/dot/bootstrap.sh /data/code/logos     # desktop
#     packages/dot/bootstrap.sh ~/code/logos         # laptop
#
# After this, every declared command (`dot`, `brucelee`, `brucelee-tui`, `entities`, `nosy`)
# is on PATH. Re-run `dot pkg logos configure` later, once `dot` itself works, after adding
# or removing a command's declaration.
set -eu

if [ $# -ne 1 ]; then
  echo "usage: $0 <path-to-logos-checkout>" >&2
  exit 2
fi

logos=$(cd "$1" 2>/dev/null && pwd -P) || {
  echo "bootstrap: $1 is not a directory" >&2
  exit 2
}

cli="$logos/apps/dot/dot.ts"
if [ ! -f "$cli" ]; then
  echo "bootstrap: $cli is not there — is $logos a logos checkout?" >&2
  exit 2
fi

# Refuse a checkout whose dependencies are not installed. Without this the first thing the
# operator sees is a module-resolution stack from inside effect, which reads as a broken CLI
# rather than as a missing `bun install`.
if [ ! -d "$logos/node_modules/effect" ]; then
  echo "bootstrap: $logos has no node_modules/effect." >&2
  echo "           run: cd $logos && bun install --filter '@app/dot' --filter '@kit/*'" >&2
  exit 2
fi

state="${XDG_STATE_HOME:-$HOME/.local/state}/dot"
mkdir -p "$state"

# The checkout root. Every command's launcher re-derives its own payload root from its own
# symlink chain (logos 13 §9.3) and reads this record for the other half — where the kit is.
printf '%s\n' "$logos" >"$state/logos-root"

# A host bootstrapped before the checkout was renamed may still hold stale record files.
# Two records would leave the launchers' answer ambiguous, so the stale ones go.
rm -f "$state/fleet-root" "$state/cli-path"

# Link the shared launcher itself, then every command declared in the workspace manifests.
# `dot pkg logos link` needs DOT_ROOT (this payload, derived by path — `dot` does not exist
# on PATH yet, which is exactly why this script exists) and nothing else from the kit's own
# resolution, since the only file that package declares is the launcher.
dot_root=$(cd "$(dirname "$0")/../.." && pwd -P)
DOT_ROOT="$dot_root" bun "$logos/apps/dot/dot.ts" pkg logos link
bun "$logos/tooling/launcher/link.ts" --root "$logos" --launcher "$HOME/.local/libexec/launcher" --into "$HOME/.local/bin"

echo "dot: logos root recorded — $logos"
echo "dot: commands linked — dot, brucelee, brucelee-tui, entities, nosy"
