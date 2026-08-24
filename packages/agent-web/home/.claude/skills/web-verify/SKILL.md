---
name: web-verify
description: Verify web UI changes in a real browser with playwright-cli — persistent per-project login, dev-server startup, screenshot/console evidence. Use for any web/React/UI change, visual check, or "does this page actually work" question.
allowed-tools: Bash(playwright-cli:*) Bash(curl:*) Bash(npm:*) Bash(bun:*)
---

# Web UI Verification

Machine-wide procedure for proving a web UI change works. Applies to every project.
Command reference lives in the `playwright-cli` skill — read it for syntax beyond this recipe.

## Invariants

- `playwright-cli` is installed globally (`~/.bun/bin/playwright-cli`), bundled Chrome-for-Testing.
- Session name is the project directory name. One persistent browser profile per project.
- Credentials live in `~/.config/secrets/agent-web` (mode 600). Site map in
  `~/.config/agent-web/sites.json`.
- Profiles live in `~/.local/state/agent-web/profiles/<session>`.
- Never create `.claude/`, `.playwright/`, or any agent config inside a project.
  A project-local `.playwright/cli.config.json` silently overrides the browser choice — delete it.

## 1. Set up the session

```bash
S=$(basename "$PWD")
P="$HOME/.local/state/agent-web/profiles/$S"
```

## 2. Make sure the app is served

```bash
curl -sf -o /dev/null -w '%{http_code}\n' http://localhost:8080/ || echo down
```

Down? Start the project's own dev script as a background/supervised process (omp: `hub` `op:"start"`;
otherwise a background bash job), wait for the port, then continue. Read `package.json` scripts —
typical names are `dev`, `debug`, `start`. Never edit the repo to make verification possible.

## 3. Open the page

```bash
playwright-cli -s=$S open "http://localhost:8080/app/some-route" \
  --persistent --profile="$P" --config="$HOME/.config/agent-web/cli.config.json"
```

`--config` is REQUIRED on `open`: without it the browser channel defaults to system `chrome`, which is
not installed on this machine, and the daemon dies with
`Chromium distribution 'chrome' is not found`. The config pins the bundled Chrome-for-Testing build.
`--browser` only accepts `chrome|firefox|webkit|msedge` (verified via `playwright-cli open --help`) —
there is no `--browser=chromium`, so the config file is the only way to select the bundled build.
Never satisfy this by dropping a `.playwright/cli.config.json` into a project.

Subsequent navigation in the same session:

```bash
playwright-cli -s=$S goto "http://localhost:8080/app/other-route"
```

`-s=$S` goes on EVERY call, before any global flag (`playwright-cli -s=$S --raw snapshot`). Omit it
and you address the `default` session, which is not open.

Useful open flags: `--headed` (user is watching), `--mobile` (smaller snapshots), `--device="iPhone 15"`.

## 4. Log in — once per profile lifetime

Detect the wall:

```bash
playwright-cli -s=$S find --regex "/sign in|se connecter|mot de passe|password/i"
```

If matched, resolve credentials and fill. Values come from the environment, never inline:

```bash
set -a; . ~/.config/secrets/agent-web; set +a
playwright-cli -s=$S --raw snapshot --depth=14      # refs for the email/password fields
playwright-cli -s=$S --raw fill e21 "$BRUCE_LOCAL_USER" >/dev/null
playwright-cli -s=$S --raw fill e26 "$BRUCE_LOCAL_PASS" --submit >/dev/null
playwright-cli -s=$S find "<something only visible when authenticated>"
```

`--raw` on the credential fills is MANDATORY: normal output echoes the generated Playwright code,
which contains the literal value (`...fill('<the actual password>')`) and would leak the secret into
the transcript. `--raw` strips the code/snapshot sections; `>/dev/null` discards the rest.

Rules:

- `"$VAR"` only. Never echo, cat, print, or paste a password into a command line, a file, or a report.
- `fill <target> <text>` takes a plain positional string. The CLI has NO secrets file, placeholder or
  token syntax (`PLAYWRIGHT_MCP_SECRETS_FILE` is a Playwright-MCP-server feature, not a CLI one), so
  shell expansion of `"$VAR"` plus `--raw` is the correct and only mechanism. Verified working.
- When a login fails, read the server's own verdict before guessing: `--raw requests`, then
  `--raw response-body <n>`. A backend rejection (e.g. Parse `{"code":101}`) means wrong credentials
  or wrong environment — report it and ask; it is never fixed by retrying or by a different selector.
- No entry for this origin in `sites.json`? Ask the user once for credentials, then append an entry
  and store the values in `~/.config/secrets/agent-web` (`chmod 600`).
- Login persists in the profile. Later runs skip this whole step; if a session expires, repeat it.
- If login fails twice, stop and report — never bypass auth, never inject tokens, never read the
  operator's own browser storage.

## 5. Verify and capture evidence

```bash
playwright-cli -s=$S find "Expected label"          # cheap assertion, greps the a11y snapshot
playwright-cli -s=$S --raw snapshot --depth=6        # structure when layout matters
playwright-cli -s=$S screenshot --filename=/tmp/agent-web/$S-route.png
playwright-cli -s=$S console error                  # runtime regressions
playwright-cli -s=$S --raw requests                 # network overview
playwright-cli -s=$S --raw request 1384             # headers for one request
playwright-cli -s=$S --raw response-body 1384       # server payload, e.g. why a login failed
playwright-cli -s=$S --raw request-body 1384        # what the app actually sent
```

Interaction: `click <ref>`, `fill <ref> <text>`, `select <ref> <value>`, `press <key>`,
`hover <ref>`, `check <ref>`. Refs (`e12`) come from the latest snapshot and are invalidated by
navigation or re-render — re-snapshot, then act.

Report format:

- route(s) exercised
- screenshot path(s)
- console errors (or "none")
- pass / fail per acceptance criterion

## 6. Let the human take over

```bash
playwright-cli show            # live dashboard: watch, click in to control, Escape to release
playwright-cli show --annotate # user annotates the page; you get screenshot + notes back
```

Use this for design review, or when a check genuinely needs human judgement.

Do NOT route logins through it by default. Its remote input is unreliable — keystrokes stop
registering even with the viewport unlocked (observed 2026-08-24). Credential login from
`~/.config/secrets/agent-web` is the primary path; the dashboard is a fallback, and if the user
reports input stalling, go back to asking them for the credentials instead.

## Session hygiene

```bash
playwright-cli list           # all sessions
playwright-cli -s=$S close    # stop this project's browser
playwright-cli kill-all       # force-kill everything (last resort)
```

Leave the profile directory in place — it holds the login.

## sites.json schema

```json
{
  "sites": [
    {
      "match": "localhost:8080",
      "session": "code",
      "loginUrl": "http://localhost:8080/app/signin",
      "userVar": "BRUCE_LOCAL_USER",
      "passVar": "BRUCE_LOCAL_PASS",
      "loggedInMarker": "Recrutements",
      "notes": "Bruce web client; Vite dev server on 8080 against development-client.api.bruce.work"
    }
  ]
}
```

`match` is an origin substring. `session` is the project directory name used with `-s=`.

## Failure ladder

1. Page unreachable → start dev server (step 2). Still unreachable → report the exact URL and command.
2. Redirected to login → step 4.
3. Login fails twice → stop, report which field/marker failed, ask for credentials.
4. Blank page / console errors → `console`, `requests`, `request <n>`; report the failing request or stack.

Never substitute a unit test, a story, or a code reading for the browser check that was asked for,
and never claim a visual result that no screenshot backs.
