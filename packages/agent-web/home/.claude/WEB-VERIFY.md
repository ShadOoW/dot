# Web UI verification (machine-wide, all projects)

A web UI change is NOT done until it has been seen in a real browser, via `playwright-cli`
(installed globally). Load the `web-verify` skill for the recipe (persistent per-project
profile, dev-server startup, login handling) and the `playwright-cli` skill for command
syntax. Hard rules that hold even before those skills are loaded:

- One persistent agent browser profile per project; never `delete-data` without asking.
- Never touch the operator's own browser data — no Chrome/Chromium profile, no cookie DB,
  no keychain, no session-token extraction. The agent profile is the only session store.
- Local/dev only, by default. NEVER send any request — login, API call, form submission,
  curl probe — to production or a shared live environment unless the user approves that
  exact target in the current conversation. "The credentials are the same" is not
  approval. If a diagnostic seems to need prod, stop and ask, stating what you would send.
- Never fabricate, inject, or bypass a session. Unknown login: check
  `~/.config/agent-web/sites.json`; missing entry: ask the user once, then add it.
- Evidence with every UI claim: URL + screenshot path + console error output.

## Machine facts that override stale repo guidance

- `cs` is NOT installed here. Ignore any repo/skill text recommending `cs browser` etc.
- No harness-native browser tools or browser relays for verification; `playwright-cli` is
  the standard because its profile is shared across every agent and harness.
- Agent config belongs in `$HOME`, never in a project: no per-project `.claude/`,
  `.playwright/`, or committed profiles/skills.
- Vitest 4: bare `--silent` before a path is a parse error — use `--silent=true <path>`;
  same for any optional-value flag placed before a positional argument.
