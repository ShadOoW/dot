#!/usr/bin/env bash
# packages/claude — deploy the canonical settings.json SEED.
# Run: dot pkg claude configure   (or: dot configure claude)
#
# Why this is a copy, not a symlink: Claude Code rewrites ~/.claude/settings.json
# with atomic writes (temp file + rename) whenever a setting changes (/model,
# theme, effort, tui, plugin enable). An atomic rename REPLACES a symlink with a
# real file, so a symlinked settings.json always drifts back to a real file and
# `dot doctor` flags it forever. Instead ~/.claude/settings.json is app-owned
# runtime state (like ~/.claude.json and credentials, which dot also doesn't
# manage), and seed/settings.json is the canonical base we install onto a fresh
# machine and keep as the human-editable source of truth.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEED="$DIR/seed/settings.json"
DEST="$HOME/.claude/settings.json"

mkdir -p "$HOME/.claude"

if [ ! -e "$DEST" ]; then
  install -m 600 "$SEED" "$DEST"
  echo "✓ installed canonical settings seed -> $DEST"
  exit 0
fi

if diff -q "$SEED" "$DEST" >/dev/null 2>&1; then
  echo "✓ $DEST already matches the seed."
  exit 0
fi

# App-owned file already exists and differs (expected: Claude Code writes runtime
# state like \"model\" here). Never clobber it — just surface the delta.
echo "• $DEST exists and differs from the seed (this is normal — Claude Code owns it)."
echo "  Review with:  diff \"$SEED\" \"$DEST\""
echo "  To re-seed from scratch (loses live runtime prefs):"
echo "      cp \"$SEED\" \"$DEST\""
