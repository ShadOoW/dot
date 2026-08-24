#!/usr/bin/env bash
# Own ~/.config/secrets, the directory the zsh login loader reads.
#
# The templates live in templates/ rather than home/.config/secrets/ on purpose. `dot link`
# walks only home/ and system/ (collectFiles, /data/code/fleet/apps/dot/src/lib/pkg.ts), so
# nothing under templates/ can be symlinked into the live credential store even by accident —
# the same structural guarantee etc-real/ relies on. Earlier versions of this package did ship
# the templates under home/, which planted .example symlinks among the real secrets; step 1
# removes those.
#
# This script never writes a secret. It owns the directory's shape — mode 700, every file 600,
# no symlinks — and reports which templates have no real file yet. Copying a template is left
# to the operator on purpose: a copied template exports KEY= empty, and an empty variable reads
# as "configured" to any consumer that tests presence rather than value.
#
# Runs unprivileged. `dot pkg secrets configure` asks for a sudo ticket before starting but
# runs the script as you (spawnInherit, not runPrivileged), so the files land owned by you.
set -euo pipefail

DIR="$HOME/.config/secrets"
TEMPLATES="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/templates"

install -d -m 700 "$DIR"

shopt -s nullglob dotglob

# 1. the stray template links older versions of this package (and agent-web) put here
for f in "$DIR"/*.example; do
  [ -L "$f" ] || continue
  rm -f "$f"
  echo "removed stray template link: ~/${f#"$HOME"/}"
done

# 2. everything left is a real credential: 600, and never a link the loader would skip
for f in "$DIR"/*; do
  if [ -L "$f" ]; then
    echo "WARNING: ~/${f#"$HOME"/} is a symlink — the loader only sources real files" >&2
    continue
  fi
  [ -f "$f" ] || continue
  mode=$(stat -c %a "$f")
  if [ "$mode" != 600 ]; then
    chmod 600 "$f"
    echo "tightened $mode -> 600: ~/${f#"$HOME"/}"
  fi
done

# 3. templates with no credential file yet. "Real file, not a link" is the same test the loader
# applies, so a symlink parked here counts as absent — which it is, as far as the environment
# is concerned.
missing=0
for t in "$TEMPLATES"/*; do
  name=$(basename "$t")
  if [ -f "$DIR/$name" ] && [ ! -L "$DIR/$name" ]; then continue; fi
  missing=$((missing + 1))
  echo "no $name yet:"
  echo "  install -m 600 $t $DIR/$name && \$EDITOR $DIR/$name"
done

echo "secrets configured: $DIR (700)${missing:+, $missing template(s) unfilled}"
