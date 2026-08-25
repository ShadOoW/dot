#!/usr/bin/env bash
# Deploy the parts of agent-web that dot's linker cannot mirror on its own:
#   - the vendor playwright-cli skill (regenerated from the CLI, not tracked here)
#   - copies of WEB-VERIFY.md for omp and opencode, which read fixed paths
#   - the extra Claude config dirs (.claude-work, .claude-personal)
#   - the browser profile directory
# Idempotent. Re-run after editing home/.claude/WEB-VERIFY.md.
set -euo pipefail

RULES="$HOME/.claude/WEB-VERIFY.md"
[ -f "$RULES" ] || {
  echo "run 'dot pkg agent-web link' first (missing $RULES)" >&2
  exit 1
}

# 1. vendor skill — installs into <cwd>/.claude/skills, so run it from $HOME
if command -v playwright-cli >/dev/null 2>&1; then
  (cd "$HOME" && playwright-cli install --skills >/dev/null)
  echo "vendor skill: $HOME/.claude/skills/playwright-cli"
else
  echo "WARNING: playwright-cli not installed (bun install -g @playwright/cli@latest)" >&2
fi

# 2. omp reads a sticky rule file here; opencode reads a user AGENTS.md here.
#    Copies, not symlinks — re-run this script after editing the source.
mkdir -p "$HOME/.omp/agent" "$HOME/.config/opencode"
cp "$RULES" "$HOME/.omp/agent/RULES.md"
cp "$RULES" "$HOME/.config/opencode/AGENTS.md"

# 3. the other Claude config dirs share ~/.claude's skills and rules
for d in "$HOME/.claude-work" "$HOME/.claude-personal"; do
  [ -d "$d" ] || continue
  [ -e "$d/skills" ] || ln -s "$HOME/.claude/skills" "$d/skills"
  cp "$RULES" "$d/WEB-VERIFY.md"
  grep -q '@WEB-VERIFY.md' "$d/CLAUDE.md" 2>/dev/null || echo '@WEB-VERIFY.md' >>"$d/CLAUDE.md"
done
grep -q '@WEB-VERIFY.md' "$HOME/.claude/CLAUDE.md" 2>/dev/null || echo '@WEB-VERIFY.md' >>"$HOME/.claude/CLAUDE.md"

# 4. opencode must scan the same skills root
if command -v jq >/dev/null 2>&1 && [ -f "$HOME/.config/opencode/opencode.json" ]; then
  tmp=$(mktemp)
  jq --arg p "$HOME/.claude/skills" '.skills.paths = [$p]' \
    "$HOME/.config/opencode/opencode.json" >"$tmp" && mv "$tmp" "$HOME/.config/opencode/opencode.json"
fi

# 5. browser profiles (runtime state, never tracked)
mkdir -p "$HOME/.local/state/agent-web/profiles" "$HOME/.local/state/agent-web/output"

# 6. credentials — owned by packages/secrets, which also keeps the directory 700 and files 600
if [ ! -f "$HOME/.config/secrets/agent-web" ]; then
  echo "NOTE: no ~/.config/secrets/agent-web yet. Run 'dot pkg secrets configure' for the command."
fi

echo "agent-web configured"
