You are a performance engineer reviewing a recorded Parse Server network session (captured by the Nosy Parker extension) against the codebase you are currently in. Your output must be actionable: every finding ends in a concrete fix at a file:line, an explicit config suppression, or a named missing-data gap. Never produce a purely descriptive report.

**Usage:** `/session-review [session|latest] [fix]`

`$ARGUMENTS` — first token: session dir name, sessionId, substring, or `latest` (default). If the literal token `fix` is present, apply the top fixes after the report (phase 6).

---

## 0. Ingest and analyze

The analyzer lives in the tracker repo; run from the current project root:

```bash
bun run --cwd /data/code/network-tracker src/cli/index.ts ingest --project "$PWD" --wait
bun run --cwd /data/code/network-tracker src/cli/index.ts analyze --project "$PWD" --force <session-token>
```

Use the session token from $ARGUMENTS (default `latest`). If `.nosy/config.json` doesn't exist yet, first run the `init` subcommand the same way. Stop with `STOPPED: [reason]` if ingest finds no export or analyze fails. Note the resolved session directory `.nosy/sessions/<id>/`.

## 1. Load context

Read in this order:

1. `.nosy/sessions/<id>/findings.json` — all findings (`summary` first).
2. `.nosy/sessions/<id>/raw/manifest.json` — session name and waypoints; waypoint labels are the user's navigation path and name your report sections.
3. `.nosy/config.json` — current thresholds and suppressions.
4. Every file in `.nosy/sessions/<id>/guides/` — `_common.md` is the triage contract; per-check guides OVERRIDE generic judgment for their check.

Do NOT read all of `orders.jsonl`. Pull individual records only while triaging a finding, by its example requestIds:

```bash
grep -F '"requestId":"<id>"' .nosy/sessions/<id>/raw/orders.jsonl
```

Then output one line: `Session: <name>, <N> requests, <W> waypoints — <C> critical / <W> warning / <I> info`.

## 2. Map findings to code

For each critical and warning finding, locate the originating code. `orderName` maps to code three ways in Bruce-style codebases — try in order:

```bash
# a) direct cloud function call
grep -rn "Cloud.run('<orderName>'" --include='*.ts' --include='*.tsx' .
# b) hashed-order system (orderName like 4wszDD68tv)
grep -rln "ORDER_<orderName>" . ; ls -d code/src/Event/Order/*/<orderName> 2>/dev/null
# c) class query construction
grep -rn "'<ClassName>'" --include='*.ts' --include='*.tsx' . | grep -iv test | head -20
```

Read the call site AND one level up the call chain (the component / effect / thunk that triggers it) — root-cause classification needs the trigger context. If no call site is found, the verdict is **needs-data**: say which shared package probably issues it.

## 3. Triage every finding

Apply the check's guide. Every finding gets exactly one verdict per the contract in `guides/_common.md`: **confirmed** (fix + root-cause class + impact), **false-positive** (you MUST act: edit `.nosy/config.json` — threshold, `perOrder` budget, `ignoreOrderNames`, or `suppressFingerprints` — or, when the check's algorithm itself misfired, append a dated, reproducible entry to `.nosy/analyzer-feedback.md`), or **needs-data** (name what to capture next session). Un-actioned false positives are a failed review.

Impact rules: derive requests/ms saved from findings.json counts and timings only (each guide states the formula); never invent numbers; say "up to" when concurrency is ambiguous.

## 4. Write the report

Write `.nosy/sessions/<id>/findings-review.md`:

```
# Session review: <sessionName>

## Priority table
| # | Finding | Root cause | Fix location | Impact | Effort (S/M/L) |
(confirmed only, ranked by impact/effort)

## Confirmed findings
### 1. <title> [checkId, severity]
What happens (reference waypoint segments by label) / Evidence / Root cause
+ mechanism at file:line / Fix precise enough to implement without
re-investigation / Impact / Effort

## False positives
(one line each: finding id, why, config change made or feedback filed)

## Needs data
(finding id, missing data, how to capture it next session)
```

Also write `.nosy/sessions/<id>/triage.json` — machine input for /session-compare:

```json
[
  {
    "findingId": "...",
    "checkId": "...",
    "fingerprint": "...",
    "verdict": "confirmed|false-positive|needs-data",
    "rootCause": "...",
    "fixFile": "path:line",
    "impactRequests": 0,
    "impactMs": 0
  }
]
```

Print the priority table to the conversation. Stop here unless `fix` was passed.

## 5. (fix mode only) Apply fixes

If on the default branch, create `nosy/<session-slug>` first. Apply confirmed fixes in priority order, one at a time: implement, run the project's typecheck/lint (see its CLAUDE.md/AGENTS.md for the command), summarize, continue. Skip effort-L fixes — list them as follow-ups. End with: "Re-record the same scenario, then run `/session-compare <this-session> latest` to verify."
