#!/usr/bin/env bash
set -euo pipefail

python3 - <<'EOF'
import json, pathlib, sys

ENTRY = {
    "command": "auggie",
    "args": ["--mcp", "--mcp-auto-workspace", "--wait-for-indexing"],
}

p = pathlib.Path.home() / ".claude.json"
d = json.loads(p.read_text()) if p.exists() else {}
servers = d.setdefault("mcpServers", {})

if servers.get("augment-context-engine") == ENTRY:
    print("augment-context-engine MCP entry already up to date.")
    sys.exit(0)

servers["augment-context-engine"] = ENTRY
p.write_text(json.dumps(d, indent=2) + "\n")
print("augment-context-engine MCP entry written to ~/.claude.json")
EOF
