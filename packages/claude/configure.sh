#!/usr/bin/env bash
# packages/claude — deploy the canonical settings.json SEED.
# Run: dot pkg claude configure
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
elif diff -q "$SEED" "$DEST" >/dev/null 2>&1; then
  echo "✓ $DEST already matches the seed."
else
  # App-owned file already exists and differs (expected: Claude Code writes runtime
  # state like \"model\" here). Never clobber it — just surface the delta.
  echo "• $DEST exists and differs from the seed (this is normal — Claude Code owns it)."
  echo "  Review with:  diff \"$SEED\" \"$DEST\""
  echo "  To re-seed from scratch (loses live runtime prefs):"
  echo "      cp \"$SEED\" \"$DEST\""
fi
# bruce skills — source of truth is the fleet tree; link, never copy. Guarded so hosts
# without /data/code/fleet (laptop) simply skip them.
for skill in bruce bruce-design bruce-plan; do
  if [ -d "/data/code/fleet/skills/$skill" ]; then
    mkdir -p "$HOME/.claude/skills"
    rm -rf "$HOME/.claude/skills/$skill"
    ln -sfn "/data/code/fleet/skills/$skill" "$HOME/.claude/skills/$skill"
    echo "✓ linked $skill skill -> /data/code/fleet/skills/$skill"
  fi
done
# omp reads skills from ~/.omp/agent/skills and ignores ~/.claude/skills unless its
# `enabledProviders` lists `claude`, which would also pull in Claude's hooks, plugins and MCP.
# Link the whole directory so omp offers exactly the skills Claude Code does. It must be
# made here, not as a symlink in home/: ~/.claude/skills mixes this package's skills with
# links made above and by agent-web, and only $HOME holds the complete set.
mkdir -p "$HOME/.omp/agent"
if [ -e "$HOME/.omp/agent/skills" ] && [ ! -L "$HOME/.omp/agent/skills" ]; then
  echo "! $HOME/.omp/agent/skills is a real directory; move its skills into ~/.claude/skills first"
else
  ln -sfn "$HOME/.claude/skills" "$HOME/.omp/agent/skills"
  echo "✓ linked omp skills -> $HOME/.claude/skills"
fi
# The other Claude config dirs (CLAUDE_CONFIG_DIR=~/.claude-work, ~/.claude-personal) read
# their own CLAUDE.md. Link it to the main one so every profile gets the same rules; a
# real file there silently drops COMMUNICATION.md and DOTFILES.md. agent-web's configure
# creates a one-line real file when none exists, so a file holding only its web-verify
# import is replaced; anything else is left alone and reported.
for d in "$HOME/.claude-work" "$HOME/.claude-personal"; do
  [ -d "$d" ] || continue
  if [ -L "$d/CLAUDE.md" ] || [ ! -e "$d/CLAUDE.md" ] ||
    [ "$(cat "$d/CLAUDE.md")" = '@~/.claude/WEB-VERIFY.md' ]; then
    ln -sfn "$HOME/.claude/CLAUDE.md" "$d/CLAUDE.md"
    echo "✓ linked $d/CLAUDE.md -> $HOME/.claude/CLAUDE.md"
  else
    echo "! $d/CLAUDE.md has its own content; merge it into ~/.claude/SHARED.md, then delete it"
  fi
done
