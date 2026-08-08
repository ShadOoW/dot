Extract reusable coding lessons from the commit diff(s) below and save them to
agentmemory. One atomic lesson per decision point — if removing half still leaves
the other half actionable, split it.

---

## Memory schema

Lessons stored in agentmemory follow this format:

[v1] {layer} {scope} {confidence} {intent?} {source}

- layer: `frontend` | `backend` | `shared`
- scope: `react` | `parse` | `ts-universal` | `domain-model`
- confidence: `high` | `medium` | `low` — how broadly confirmed the pattern is
  in the codebase via Augment queries and grep
- intent: `enforce` (optional) — when present, this is a deliberate team
  decision to establish a standard, not an observation of existing practice.
  The codebase may not yet be uniform. Apply as a hard rule in all new code.
  Flag existing violations as technical debt to fix.
- source: BRC-XXXX ticket or commit hash

Applying lessons by combination:

- `high` or `medium`, no intent → strong guidance, apply consistently
- `low`, no intent → suggestion, mention uncertainty if relevant
- any confidence + `{intent: enforce}` → hard rule, never deviate,
  flag violations in code you touch

---

## 0. Preflight

Verify all three prerequisites before doing anything else.

- Bash: `pwd` — confirm you are in the project root.
  If the path does not contain `bruce`, stop immediately:
  "STOPPED: wrong working directory. Relaunch Claude Code from the bruce project root."
- Bash: curl -s http://localhost:3111/agentmemory/health | jq -r '.status'
- Augment: load the schema via ToolSearch (`select:mcp__augment-context-engine__codebase-retrieval`),
  then run a trivial natural language query to confirm it responds.
  The parent never calls Augment inline after this — step 3 sub-agents and the
  step 6c adversarial agent call it independently in their own context windows.
- Bash: `cat ~/.claude/commands/challenge-learning.md > /dev/null && echo "OK" || echo "MISSING"`

If any check fails, output exactly this and stop:

```
STOPPED: [agentmemory / Augment / challenge-learning.md] is not reachable.
Fix: [run 'agentmemory' in terminal / restart session / run: cd ~/code/dotfiles && stow packages/claude]
```

---

## 1. Load

Fetch existing lessons and watchlist entries via MCP:

```
memory_smart_search(query: "[v1] confidence rule evidence", limit: 50)
memory_smart_search(query: "watchlist", limit: 20)
```

Do not use `GET /agentmemory/memories` — it filters out recently saved memories.

Read every result fully. Check for any existing watchlist entry — if one covers
the same topic as a candidate from this diff, prefer tagging or strengthening it
over creating a duplicate. Then output this block before proceeding:

```
Existing lessons cover: [up to 5 themes]
This diff may add:      [themes not yet covered]
Session note:           [flag if learn-from-commits already ran this session —
                         Augment index may not reflect the latest commit yet]
```

**Multiple commits:** count `^commit ` lines in $ARGUMENTS. If more than one,
build and maintain this table as you process each commit in order:

| Candidate | Seen in N commits | Confidence |
| --------- | ----------------- | ---------- |

- New pattern → add row at LOW
- Seen again → increment count, elevate confidence one level
- Introduced then removed → mark as intra-batch contradiction

Finalize the table before moving to extraction.

**Commit message:** use it to scope lessons if it carries meaningful information
about the change — a pattern solving a narrow problem may not generalize. If
the message is absent or carries no semantic information about the change, infer
intent from the diff shape.

---

## 2. Extract

**Start with removals and replacements.** A deleted or rewritten block explicitly
names an anti-pattern. These are the highest-signal lessons.

**Then scan additions** — only in dimensions where the diff has actual signal:

| Dimension                | What to look for                                         |
| ------------------------ | -------------------------------------------------------- |
| Types                    | Aliases, generics, casting, inference, what was avoided  |
| File structure           | Placement logic, when to split a flat file into a folder |
| Within-file organization | Region conventions, ordering                             |
| State and async          | Loading states, tri-state booleans, guards               |
| Data                     | Fetching, filtering, pagination, ID-based hydration      |
| UI                       | Flex/grid rules, prop design, conditional rendering      |

For any moved, renamed, or newly created file, run `ls` on the file's parent,
grandparent, and further ancestors until you reach a level where the directory
names make the organizing principle obvious. Read what else lives at each level.
A good placement rule explains the whole visible structure, not just the one
file that changed — if the rule only describes one folder, it is probably still
an instance of a more general rule waiting to be written.

## ⛔ DROP ACCOUNTING — write this block now, before running any Augment queries

Every pattern you identified but chose NOT to extract as a candidate must be listed
here. This is a checkpoint: do not proceed to Step 3 until this block is written.

```
Dropped: [pattern description] — [one-line reason: too narrow / consequence of another candidate / not generalizable / etc.]
```

If you drop nothing, write `Dropped: none`. A silent discard is a bug in the process.

---

## 3. Assess confidence — parallel sub-agents

**Do not run Augment queries inline.** Raw snippet content must never accumulate
in the parent context. Dispatch ALL candidates in a **single message** as parallel
Agent calls (`subagent_type: "Explore"`).

Each sub-agent handles exactly one candidate and returns ~300 tokens of structured
output. The parent never sees raw snippets.

### Build each sub-agent prompt

Construct one prompt per candidate. Each prompt has three parts in order:

**Part A — Candidate**
State: what the pattern is, what was removed/replaced, one concrete diff example.

**Part B — Diff excerpt**
Paste only the diff hunks relevant to this candidate. Omit unrelated hunks.

**Part C — Copy these instructions verbatim:**

```
You are assessing confidence for one lesson candidate from a commit diff.
You have full access to Augment and bash tools.

Step 1 — Load Augment:
ToolSearch("select:mcp__augment-context-engine__codebase-retrieval"), then run
a trivial query to confirm it responds.

Step 2 — Run 3 queries from conceptually different angles:
1. The pattern      — positive form: what you are looking for
2. The anti-pattern — negative form: what was removed / the old way
3. Structural/domain consequence — what breaks or appears elsewhere when the
   rule is followed or violated

Snippets must spread across different queries to count. 5 snippets from query 1
and 0 from queries 2 and 3 does NOT qualify for HIGH — that is one narrow cluster.

If a query returns 0 or irrelevant results, rephrase and retry once. Log both:
  Failed: "[original query]" → 0 results
  Retry:  "[rephrased query]" → N results
If still no results after retry, note the failed query and continue with the
remaining queries. Never mark a lesson UNVERIFIED without having tried all
3 distinct queries. "No retry attempted" is not acceptable output.

Step 3 — Structural check (only for folder placement, file naming, region
conventions, file-to-folder conversions):
  find . -type f \( -name "*.ts" -o -name "*.tsx" \) | \
    xargs grep -l "[key term]" 2>/dev/null | head -20
  Structural confidence requires Augment signal AND grep ≥ 3 matching files.

Step 4 — Enforce gate (MANDATORY if proposing `{intent: enforce}`):
A ban-motivated rule cannot claim enforce without a surviving-violation
grep over the applicable scope. Adoption rate is not violation rate;
design the grep to exclude legitimate non-violations. Augment's Step 2
anti-pattern query is fuzzy match, not a count — it does not substitute.

  grep -rnE "[violation regex]" [paths] --include="*.tsx" --include="*.ts" | wc -l
  grep -rnE "[applicable scope]" [paths] --include="*.tsx" --include="*.ts" -l | wc -l

Paths must cover files outside the changed diff — searching only within modified files produces false 0% violation rates.

Enforce holds only when one is true:
  (a) violations ≤ 2% of applicable usages, OR
  (b) rule text scopes to new/touched code with tech-debt count named
      (forward-only enforce), OR
  (c) the anti-pattern is a correctness footgun (silent data loss, crash,
      security) — confidence ≥ MEDIUM still required.

Multi-file refactor in one commit is intent, not adoption — insufficient
alone. Otherwise, save as confidence-only.

Confidence levels:
  HIGH   — 5+ distinct snippets across ≥ 2 queries. Diff evidence = supporting
            signal only, cannot substitute. Structural: also requires grep ≥ 3 files.
  MEDIUM — 2–4 snippets, OR 1 snippet AND an explicit removal/replacement in diff.
            Diff-only with 0 Augment snippets → LOW regardless.
  LOW    — 0–1 Augment snippets.

Pre-existing convention: if Augment returns 5+ snippets for a pattern NOT
touched by the diff, flag as "pre-existing" in output.

Layer:
  shared   — applies across app/, sms/, doc/ top-level projects
  frontend — app/client/web specific (React, MUI, Redux)
  backend  — sms/server specific (Parse, Node, API)

Scope:
  react        — React lifecycle, hooks, JSX
  parse        — Parse Server, Piece/Recorded/Argument types
  ts-universal — any TypeScript codebase, not domain-specific
  domain-model — depends on Template/Order/Scope/Unit domain meaning

RETURN THIS EXACT FORMAT — NOTHING ELSE. No raw snippets, no narrative sections,
no "summary" or "recommendation" prose. Hard limit: 400 tokens. If over limit,
drop prose — keep the table, Lesson block, and any mandatory grep/enforce lines.

Candidate: [title]
| # | Angle        | Query                          | Snippets | Summary (1 line)      |
|---|--------------|--------------------------------|----------|-----------------------|
| 1 | pattern      | "..."                          | N        | [what it confirmed]   |
| 2 | anti-pattern | "..."                          | N        | [what it confirmed]   |
| 3 | consequence  | "..."                          | N        | [what it confirmed]   |
Total distinct snippets: N  →  [HIGH / MEDIUM / LOW]
[If failed + retried, include:]
Failed: "[original query]" → 0 results
Retry:  "[rephrased query]" → N results
[Structural candidates only, include:]
Grep: [exact command] → N matching files
[If pre-existing, include:]
Pre-existing: flagged — 5+ snippets on pattern not touched by this diff
[If proposing {intent: enforce}, include — MANDATORY:]
Anti-pattern grep: [command] → N violations / M applicable usages (X%)
Enforce justification: [adoption / forward-only / footgun]

Confidence: [HIGH / MEDIUM / LOW]

Lesson:
[v1] {layer: X} {scope: Y} {confidence: Z} {intent: enforce}? {source: [hash]}
Title: [3–5 words — count before writing]
Rule:  [full actionable instruction — reads cold 6 months from now]
Evidence: [one concrete example from the diff]
```

Report exact snippet counts — never "30+" or "many". For large result sets,
spot-check the top 10 and report `N (X/10 relevant)`.

For `{layer: shared}`, verify the rule appears in both `app/client/web` AND
`app/base/web` (and `sms/server` if relevant). For `{layer: frontend}`, still
spot-check `app/base/web`; if it applies there too, retag as `shared`.

### After all sub-agents return

Collect the structured outputs. Do not re-run any Augment queries in the parent.

Output a compact audit table before proceeding — required for every run:

| Candidate | Confidence | Total snippets | Source type         |
| --------- | ---------- | -------------- | ------------------- |
| [title]   | HIGH       | N              | removal/replacement |

Do not proceed to Step 4 without this table.

If any HIGH lesson reports "N+" instead of an exact count, downgrade to MEDIUM
until the count is exact.

Apply cross-commit recurrence adjustment (only if input had multiple commits):

- Same candidate seen in 2 commits → elevate its confidence one level
- Same candidate seen in 3+ commits → always HIGH

Proceed directly to Step 4.

---

## 4. Lesson format

Sub-agents from step 3 have already drafted lessons. Verify each draft meets
the constraints below; adjust wording only if a constraint is violated.

Every lesson must be saved using this exact format. No exceptions.

```
[v1] {layer: [frontend|backend|shared]} {scope: [react|parse|ts-universal|domain-model]} {confidence: [high|medium|low]} {intent: enforce}? {source: [BRC-XXXX or commit hash]}
Title: [3–5 words]
Rule: [the full actionable instruction]
Evidence: [one concrete example from the diff]
```

**Choosing layer and scope:**

| Layer      | When to use                                                                  |
| ---------- | ---------------------------------------------------------------------------- |
| `frontend` | app/client/web specific — React, MUI, Redux                                  |
| `backend`  | sms/server specific — Parse, Node, API design                                |
| `shared`   | Applies to files in more than one top-level project (app/, sms/, lib/, doc/) |

**Layer decision test:** Does this rule apply to files under more than one top-level
project directory? If yes → `shared`. If the rule only makes sense in one project's
context even when the TypeScript pattern looks similar → use the more specific layer.

| Scope          | When to use                                                     |
| -------------- | --------------------------------------------------------------- |
| `react`        | React/component-specific — ignore in backend sessions           |
| `parse`        | Parse platform specific — ignore in frontend sessions           |
| `ts-universal` | General TypeScript — relevant everywhere                        |
| `domain-model` | How orders/events/classes are represented — relevant everywhere |

**Format constraints:**

- Title must be 3–5 words. Count before presenting. Reword immediately if outside range — do not explain the constraint, just fix it.
- Rule must be actionable when read cold, 6 months from now, by someone who
  never saw this commit
- If the rule contains "and" connecting two independent instructions, split it
  into two lessons
- For structural rules: ask "would a reader know exactly where to place a new
  file without asking a follow-up?" If not, generalize until they would
- Use the most natural form:
  - Behavioral: "When [situation], always/never [action] because [reason]"
  - Structural: "Files/regions that [condition] belong in [location] because [reason]"
  - Typing: "[Pattern] is wrong because [reason]; use [alternative] instead"
  - Convention: "[Area] is reserved for [purpose] — never use it for [anti-pattern]"

These constraints apply equally to adversarial rewordings from section 6c.
A reword that violates them must be re-revised or split before adopting.

---

## 5. Dedup

**Always write an explicit result block, even when trivial:**

```
Step 5 — Dedup: Store empty — all candidates → ➕ NEW
```

or list each candidate's match result individually.

Check every candidate against the loaded lessons list. Apply the first match:

**Identical principle:**
Strengthen — do not save a new lesson:

```bash
curl -s -X POST http://localhost:3111/agentmemory/lesson-strengthen \
  -H "Content-Type: application/json" \
  -d '{"memId": "mem_xxx"}'
```

If the new commit reveals better wording, flag as a revision — do not re-save.
Mark: 🔁 STRENGTHENED

**Adds independently actionable detail** (survives without the parent lesson):
New lesson. Mark: ➕ NEW (extends mem_xxx)

**Adds detail only meaningful alongside an existing lesson:**
Propose a content revision to the existing entry — not a new lesson.
Mark: ✏️ REVISE mem_xxx — show current and proposed full text

**Contradicts an existing lesson:**
Show both versions with diff and Augment evidence. Force resolution now:

> "Keep existing mem_xxx or replace with new evidence?"

Wait for answer before continuing.
Mark: ⚠️ RESOLVED — [kept / replaced]

**No overlap:**
Mark: ➕ NEW

---

## 6. Present

Output findings in this order. Never truncate content.

**New lessons** (HIGH and MEDIUM only — see LOW handling below):

Lesson header format: `[N] {CONFIDENCE} · {layer} · {scope}` — append ` [enforce]` when intent is enforce.

```
[N] HIGH · frontend · react [enforce]
Title:    Region MODEL for store hydration only          ← verify 3–5 words
Rule:     #region MODEL is reserved exclusively for bring*/selector calls that load
          domain objects from the Redux store. Never use it for prop destructuring
          or generic setup.
Evidence: Helder moved generic setup out of MODEL in the requirement controller.
Format:   [v1] {layer: frontend} {scope: react} {confidence: high} {intent: enforce} {source: BRC-8574}
Augment:  4 snippets across 3 queries confirming this pattern
Grep:     [structural lessons only — file count and command used]
Source:   removal/replacement | repeated | single-instance | pre-existing
```

**Strengthened:**

```
🔁 mem_xxx — "title"
   Augment: X snippets confirming still active in codebase
   Wording revision: none | proposed: "..."
```

**Revisions proposed:**

```
✏️ mem_xxx — "title"
   Current:  [full current text]
   Proposed: [full replacement text]
   Reason:   [what the new commit and Augment revealed]
```

**Contradictions:** already resolved above — show final state only

**Dropped candidates** (from Step 2 accounting — listed here for visibility):

```
Dropped: [description] — [reason]
```

**LOW confidence watchlist:**
These were seen once with no verification. Not saved now as individual lessons.
Will be re-evaluated by review-lessons — enforced entries are promoted regardless of recurrence.

List each with title, one-line description, and intent flag if applicable:

- "title" {intent: enforce} — description
- "title" — description

Save all as one entry: memory_save(type="watchlist")
The {intent: enforce} flag must be preserved in the watchlist content so
review-lessons can read it when promoting entries later.

**Summary:**

```
New:       N (X high, Y medium, Z low)
Enforced:  E of the above (counted within their confidence bucket, not separately)
Strengthened: M
Revisions:    P
Watchlisted:  Q
Reinforcement ratio: M/(N+M) = R%
```

---

## 6c. Adversarial review (automatic)

After outputting the Summary block, immediately spawn adversarial reviewers in parallel.
Do not wait for user input — this runs before the stop.

**Step 1 — Read the challenge instructions:**

```bash
cat ~/.claude/commands/challenge-learning.md
```

**Step 2 — Assemble per-lesson prompts.** Build one prompt per lesson. Each prompt has
two parts. Pull query strings and snippet counts from the step 3 sub-agent outputs.

**Part 1 — Single-lesson context block** (one lesson per sub-agent — do not bundle):

```
## Proposed lessons

LESSON [N]
Header:    [N] {CONFIDENCE} · {layer} · {scope} [enforce?]
Title:     [title]
Rule:      [full rule text]
Evidence:  [evidence field]
Diff excerpt: [the specific ± diff lines cited in Evidence — not the full diff,
paste only the relevant before/after lines. Hard limit: 40 lines. If the hunk
is longer, include only the lines the Evidence field directly references.]
Format:    [format line]
Queries:
  Q1 ([angle]): "[query string]" → [N] snippets
  Q2 ([angle]): "[query string]" → [N] snippets
  Q3 ([angle]): "[query string]" → [N] snippets
Grep:      [command and result — structural lessons only]
Source:    [removal/replacement | repeated | single-instance | pre-existing]

## Dropped candidates
(none — reviewed by separate sub-agent)

## Watchlist
(none — reviewed by separate sub-agent)

---

```

**Part 2** — the full content read from `challenge-learning.md` in step 1.

Also build one prompt for dropped candidates and watchlist (skip if both are empty):

```
## Proposed lessons
(none — reviewed by per-lesson sub-agents)

## Dropped candidates

DROPPED: [description] — [reason]
[repeat for each]

## Watchlist

WATCHLIST: "[title]" {intent: enforce}? — [description]
[repeat for each]

---

```

Plus the full challenge-learning.md content.

**Step 3 — Dispatch all reviewers in a single message.** Default: one sub-agent
per lesson. Exception: if 2–3 lessons share the same source file and have
non-overlapping concerns, assign them to one sub-agent — it already loads Augment
once and the shared file context costs nothing extra. Each sub-agent returns one
verdict block per lesson it handles. The dropped/watchlist sub-agent is separate.

**Step 4 — Aggregate verdicts** in lesson order. Append combined output below:

```
---
## Adversarial Review
[verdict block for lesson 1]
[verdict block for lesson 2]
...
[dropped/watchlist review if applicable]
---
```

The parent sees only the sub-agents' final verdict blocks — not their intermediate queries.

**Step 5 — After aggregating verdicts, emit a "Net to save" block** listing
the post-adversarial state of each lesson. Any demotion to watchlist must
appear here — never silently demote between proposal and section 7:

```
Net to save after adversarial review:
  [N] "title" — CONFIRMED → save as proposed
  [N] "title" — DOWNGRADE (HIGH→MEDIUM, scope react→ts-universal)
  [N] "title" — REMOVE ENFORCE
  [N] "title" — REJECTED → not saving
  [N] "title" — DEMOTED to watchlist (was MEDIUM)
```

---

**Stop here.** Review the proposed lessons and adversarial verdicts above. Nothing executes until section 7.

- To approve all confirmed lessons: "save"
- To approve selectively: "save 1, 3, 5"
- To override an adversarial verdict: "override [N] [your decision]"
- To resolve an UNRESOLVED verdict: "resolve [N] [your reasoning]"
  Records the resolution and includes the lesson in the next save batch.
- To promote a LOW lesson immediately: "promote [title]"
  Saves at LOW confidence as a regular lesson — applied based on evidence strength.
- To enforce a LOW lesson as a team directive: "enforce [title]"
  Saves with {intent: enforce} — confidence stays LOW but the rule is applied as
  a hard rule in future sessions regardless of confidence. Use promote when the
  evidence justifies saving despite LOW; use enforce when it is a team decision
  independent of evidence.
- To reword before saving: edit inline, then confirm

**Layer/scope conflict:** If the adversarial reviewer proposes a different layer or
scope tag than the step 3 sub-agent assigned, the challenger's change requires grep
evidence that the pattern is absent from the other project context. A tag change
without such evidence is not adopted — the step 3 tag stands.

---

## 7. Save

Show a dry run before executing — titles only, full content already approved:

```
Ready to execute:
  SAVES (N): 'title 1' {intent: enforce}, 'title 2'
  STRENGTHENS (M): mem_xxx 'title'
  REVISIONS (P):  mem_xxx → 'new title'
  WATCHLIST:      N entries

Confirm with 'save' or 'save 1, 3'
```

On confirmation, execute in this order:

1. Saves: memory_save(type="pattern") for each — include {intent: enforce}
   in the content string for any lesson promoted via "enforce [title]"
2. Strengthens: `lesson-strengthen` for each
3. Revisions: `forget` old ID → `memory_save` new content
4. Watchlist: `memory_save(type="watchlist", content=[array of descriptions])`

---

## 8. Verify

For each saved lesson, call `memory_smart_search` with the lesson title and
confirm the mem ID from the save response appears in results.

Do not use `GET /agentmemory/memories` — it filters out recently saved memories.

Confirm for each save:

- The mem ID from the save response appears in smart_search results
- Saved content matches approved text exactly — not truncated

**If a mem ID is not retrievable:**

1. Retry that save once
2. If retry fails, output: `MANUAL SAVE NEEDED: memory_save(type='pattern', content='...')`

**Retrievability check** — for any unusually worded lesson:
Run 3 Augment queries with genuinely different phrasings. Flag if the lesson
does not surface in the top 5 results — the wording may be too obscure for
future recall. Suggest a reword.

**Final output:**

```
✅ mem_xxx — "title" — saved and verified
🔁 mem_xxx — "title" — strengthened
✏️ mem_xxx — "title" — revised (old deleted, new saved)
📋 watchlist  — N entries saved
❌ mem_xxx — "title" — FAILED: manual save needed

Done. Store: N total | +X saved | ~Y strengthened | ✏️Z revised | 📋W watchlisted
```

---

$ARGUMENTS
