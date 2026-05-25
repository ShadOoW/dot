#!/usr/bin/env bash
set -euo pipefail

python3 - <<'EOF'
import json, pathlib, sys

ENTRY = {
    "command": "agentmemory",
    "args": ["mcp"],
    "env": {"AGENTMEMORY_URL": "http://localhost:3111"},
}

p = pathlib.Path.home() / ".claude.json"
d = json.loads(p.read_text()) if p.exists() else {}
servers = d.setdefault("mcpServers", {})

if servers.get("agentmemory") == ENTRY:
    print("agentmemory MCP entry already up to date.")
    sys.exit(0)

servers["agentmemory"] = ENTRY
p.write_text(json.dumps(d, indent=2) + "\n")
print("agentmemory MCP entry written to ~/.claude.json")
EOF
