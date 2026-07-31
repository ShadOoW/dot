#!/usr/bin/env bash
# packages/oh-my-openagent — register plugin entries in opencode.json + tui.json,
# expose ast-grep on PATH. Idempotent.
#
# Why this is a script, not a symlink:
#   ~/.config/opencode/opencode.json and tui.json are app-owned runtime state.
#   dot link symlinks files at install time, but the OMO installer also rewrites
#   the `plugin` array at runtime. We need an idempotent merge that preserves
#   existing `permission` and `mcp` blocks (agentmemory, augment-context-engine).
set -euo pipefail

# ── 1. ast-grep: surface the headroom-ai binary on PATH if not already linked ──
mkdir -p "$HOME/.local/bin"
if ! command -v ast-grep >/dev/null 2>&1; then
  src="$HOME/.local/share/uv/tools/headroom-ai/bin/ast-grep"
  if [ -x "$src" ]; then
    ln -sf "$src" "$HOME/.local/bin/ast-grep"
    echo "✓ linked ast-grep -> $src"
  else
    echo "• ast-grep not on PATH and headroom-ai binary not found at $src"
    echo "  The ast-grep skill will degrade; install ast-grep or set OMO_AST_GREP_SG_PATH."
  fi
fi

# ── 2. plugin-array merge into opencode.json and tui.json ──
# Both files use the same shape: { ..., "plugin": [...] }.
# Add oh-my-openagent@latest and opencode-antigravity-auth@latest if missing.
python3 - <<'PYEOF'
import json, pathlib, sys

PLUGIN_TARGETS = ("oh-my-openagent@latest", "opencode-antigravity-auth@latest")

home = pathlib.Path.home()
candidates = [
    home / ".config/opencode/opencode.json",
    home / ".config/opencode/tui.json",
]

for path in candidates:
    if not path.exists():
        continue

    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as e:
        print(f"• skipping {path}: invalid JSON ({e})")
        continue

    plugins = data.setdefault("plugin", [])
    added = [p for p in PLUGIN_TARGETS if p not in plugins]
    if not added:
        print(f"✓ {path}: plugin array already complete.")
        continue

    plugins.extend(added)
    # keep the array tidy: oh-my-openagent first, antigravity after
    seen = set()
    deduped = []
    order = ["oh-my-openagent@latest", "opencode-antigravity-auth@latest"]
    for name in order:
        if name in plugins and name not in seen:
            deduped.append(name)
            seen.add(name)
    for name in plugins:
        if name not in seen:
            deduped.append(name)
            seen.add(name)
    data["plugin"] = deduped

    path.write_text(json.dumps(data, indent=2) + "\n")
    print(f"✓ {path}: added {added}; plugin={deduped}")
PYEOF
