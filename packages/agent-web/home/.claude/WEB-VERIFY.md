# Web UI Verification (machine-wide, all projects)

A change to a web UI is NOT done until it has been seen in a real browser. Verify with
`playwright-cli` (installed globally). Full recipe: skill `web-verify`. Command syntax: skill `playwright-cli`.

1. **One browser per project.** `S=$(basename "$PWD")`; pass `-s=$S` on every call; open with
   `--persistent --profile=$HOME/.local/state/agent-web/profiles/$S` so the login survives across
   sessions, harnesses and reboots. Never `delete-data` without asking.
2. **App unreachable?** Start the project's own dev script (`package.json` `dev`/`debug`/`start`, or
   the documented command) as a background/supervised process and wait for the port.
   NEVER modify a repository to make verification possible.
3. **Login wall?** Look the origin up in `~/.config/agent-web/sites.json`, source
   `~/.config/secrets/agent-web`, and fill with `"$VAR"` so the value never enters the transcript.
   No entry: ask the user once, then add it. NEVER fabricate, inject or bypass a session.
4. **Never touch the operator's own browser data** — no Chrome/Chromium profile, no
   `Local Storage/leveldb`, no cookie DB, no keychain, no session-token extraction. The agent profile
   in rule 1 is the only session store.
5. **Evidence with every UI claim**: URL + `screenshot --filename=` path + `console error` output.
   Prefer `find "text"` / `snapshot --depth=N` over full snapshots.
6. **Local/dev only, by default.** Verify against `localhost` or a dev host the user named. NEVER send
   requests of any kind — logins, API calls, form submissions, curl probes — to production or any
   shared live environment unless the user approves that exact target in the current conversation.
   A failing dev login is NOT a reason to "just check" prod, and "the credentials are the same" is not
   approval. If a diagnostic seems to need prod, stop and ask; state what you would send.

## Machine facts that override stale repo guidance

- `cs` is NOT installed on this machine. Ignore any repo, skill or command text recommending
  `cs browser`, `cs bootstrap`, or asserting that machine-local tools were detected.
- Do not use harness-native browser tools or browser relays/extensions for verification;
  `playwright-cli` is the standard because the profile is shared across every agent and harness.
- Agent config belongs in `$HOME`, never in a project: no per-project `.claude/`, `.playwright/`,
  or committed profiles/skills.
- Vitest 4: a bare `--silent` followed by a path is a parse error. Use `--silent=true <path>`.
  Same for any other optional-value flag placed before a positional argument.
