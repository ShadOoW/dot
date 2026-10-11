#!/usr/bin/env sh
# Record where this host keeps the kit, so the launchers can find the CLIs.
#
# Plain sh and no dependency on `dot`, because on a fresh host `dot` is exactly what does not
# work yet: this repo is the payload, the TypeScript lives in the kit, and nothing in either
# tree knows where the other was cloned. That is the one fact per host this writes down.
#
# Usage:
#
#     packages/dot/bootstrap.sh /data/code/logos     # desktop
#     packages/dot/bootstrap.sh ~/code/logos         # laptop
#
# Then `dot pkg dot link` puts the launcher on PATH, and `dot pkg logos link` puts the other
# logos CLIs there too.
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
printf '%s\n' "$cli" >"$state/cli-path"

# The checkout root, as well as the one file inside it. `dot`'s own launcher needs the file
# and derives nothing; packages/logos' launchers need the root, because each one names a
# different entry point under apps/. Deriving one from the other is possible — three
# dirnames — and is the kind of arithmetic that silently stops being true the moment an
# entry point moves, which is precisely the mistake the header of dot's launcher records
# four revisions of. Two lines instead.
printf '%s\n' "$logos" >"$state/logos-root"

# A host bootstrapped before the checkout was renamed may still hold the old record file.
# Two records would leave the launchers' answer ambiguous, so the stale one goes.
rm -f "$state/fleet-root"

echo "dot: kit recorded — $cli"
echo "dot: logos root recorded — $logos"
