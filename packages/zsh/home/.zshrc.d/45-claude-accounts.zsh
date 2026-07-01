claude-work() {
  local dir="$HOME/.claude-work"
  local real_claude
  real_claude=$(command -v claude) || { echo "claude not found in PATH"; return 1 }

  # Setup shared config symlinks (idempotent)
  mkdir -p "$dir"
  local item
  for item in settings.json CLAUDE.md RTK.md commands hooks plugins; do
    local src="$HOME/.claude/$item"
    local dst="$dir/$item"
    [[ -e "$src" && ! -e "$dst" ]] && ln -sf "$src" "$dst"
  done

  # headroom's RTK/MCP setup hardcodes ~/.claude and ignores CLAUDE_CONFIG_DIR.
  # Injecting CLAUDE_CONFIG_DIR into headroom's env causes claude to start with a
  # "foreign" config dir that headroom didn't prepare, triggering fullscreen mode.
  # Fix: give headroom a wrapper named "claude" that injects CLAUDE_CONFIG_DIR only
  # when the real claude binary is launched, keeping headroom's setup against ~/.claude.
  local tmpdir
  tmpdir=$(mktemp -d)
  printf '#!/usr/bin/env zsh\nexport CLAUDE_CONFIG_DIR="%s"\nexec "%s" "$@"\n' \
    "$dir" "$real_claude" > "$tmpdir/claude"
  chmod +x "$tmpdir/claude"

  PATH="$tmpdir:$PATH" headroom wrap claude "$@"
  local ret=$?
  rm -rf "$tmpdir"
  return $ret
}
