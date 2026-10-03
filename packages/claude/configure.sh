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
# Fleet's skills are source code in the fleet tree, one folder each under <fleet>/skills/.
# A skill fleet links from its own committed .claude/skills/ is fleet-only and loads only
# there; every other one is linked here, so it loads in every project. There is no list:
# adding a skill, or making one fleet-only, is a fleet commit. The checkout is the per-host
# record packages/dot/bootstrap.sh writes, the same one the fleet launchers read; a host
# without it skips this block.
record="${XDG_STATE_HOME:-$HOME/.local/state}/dot/fleet-root"
fleet=""
[ -f "$record" ] && fleet=$(cat "$record")
if [ -n "$fleet" ] && [ -d "$fleet/skills" ]; then
  mkdir -p "$HOME/.claude/skills"
  # A link into fleet whose skill was deleted or became fleet-only is removed, so a skill
  # never keeps loading everywhere after fleet stopped offering it.
  for link in "$HOME/.claude/skills"/*; do
    [ -L "$link" ] || continue
    name=${link##*/}
    case $(readlink "$link") in
      "$fleet/skills/"*)
        if [ ! -f "$fleet/skills/$name/SKILL.md" ] || [ -L "$fleet/.claude/skills/$name" ]; then
          rm "$link"
          echo "✓ unlinked $name skill — gone from fleet, or fleet-only"
        fi
        ;;
    esac
  done
  for src in "$fleet/skills"/*/; do
    name=$(basename "$src")
    [ -f "$src/SKILL.md" ] || continue
    [ -L "$fleet/.claude/skills/$name" ] && continue
    dest="$HOME/.claude/skills/$name"
    if [ -e "$dest" ] && [ ! -L "$dest" ]; then
      echo "! $dest is a real directory; fleet's $name skill is not linked over it"
      continue
    fi
    ln -sfn "$fleet/skills/$name" "$dest"
    echo "✓ linked $name skill -> $fleet/skills/$name"
  done
else
  echo "• no fleet checkout recorded at $record — fleet's skills are not linked"
fi
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
