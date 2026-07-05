You are verifying whether a code change improved recorded network behavior between two Nosy Parker sessions in this project. The deliverable is a per-fix verdict, not a description.

**Usage:** `/session-compare <session-a> <session-b|latest>`

`$ARGUMENTS` — two session tokens (dir name, sessionId, substring, or `latest`). Session A is the baseline (before), B the candidate (after).

## 0. Resolve and analyze both sessions

```bash
ls .nosy/sessions/
bun run --cwd /data/code/network-tracker src/cli/index.ts ingest --project "$PWD"
bun run --cwd /data/code/network-tracker src/cli/index.ts analyze --project "$PWD" --force <token>
```

Ensure both sessions have `findings.json` (analyze any that lack one). Stop with `STOPPED: [reason]` if either session can't be resolved.

## 1. Align navigation segments

Match waypoints between the two manifests (`raw/manifest.json`) by label. If the navigation paths differ materially, say so explicitly and compare only the shared segments — do not compare apples to oranges silently.

## 2. Diff findings

Join `findings.json` records on `fingerprint` + `checkId` (fall back to `shapeFingerprint` + `checkId`): classify each as **resolved** (in A, not B), **persisting**, **new** (in B only), or **changed-magnitude** (same finding, different count/timing). If A has a `triage.json`, report resolution per intended fix: "the fix for <findingId> worked: 12→1 requests on <segment>".

## 3. Diff aggregate metrics per shared segment

From both `orders.jsonl` files (bash, not full reads):

```bash
wc -l .nosy/sessions/<id>/raw/orders.jsonl
grep -c '"status":5' .nosy/sessions/<id>/raw/orders.jsonl
```

Compare request count, error count, and total duration per matched segment (sum `durationMs` with awk or jq).

## 4. Verdict

Write `.nosy/compare/<a>-vs-<b>.md` (create the dir) and print the verdict table:

| Fix (from A's triage) | Verdict                             | Evidence               |
| --------------------- | ----------------------------------- | ---------------------- |
| ...                   | VERIFIED / NOT RESOLVED / REGRESSED | before→after counts/ms |

Then list new findings in B (flag any whose check has an entry in `.nosy/analyzer-feedback.md` as known-noisy) and the aggregate segment table. If a fix shows NOT RESOLVED, check whether session B actually exercised the same flow (segment alignment from step 1) before blaming the fix.
