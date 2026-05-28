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

Verify both MCP servers are reachable before doing anything else.

- Bash: `curl -s http://localhost:3111/agentmemory/health`
- Augment: load the schema via ToolSearch (`select:mcp__augment-context-engine__codebase-retrieval`),
  then run a trivial natural language query to confirm it responds. Call it directly in all subsequent
  steps — never route Augment queries through sub-agents.

If either fails, output exactly this and stop:

```
STOPPED: [agentmemory / Augment] is not reachable.
Fix: [run 'agentmemory' in terminal / restart session]
```

---

## 1. Load

Fetch all existing lessons:

```bash
curl -s http://localhost:3111/agentmemory/memories
```

Read every lesson fully. Check for any existing watchlist entry — if one covers
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
|-----------|-------------------|------------|

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

| Dimension | What to look for |
|-----------|-----------------|
| Types | Aliases, generics, casting, inference, what was avoided |
| File structure | Placement logic, when to split a flat file into a folder |
| Within-file organization | Region conventions, ordering |
| State and async | Loading states, tri-state booleans, guards |
| Data | Fetching, filtering, pagination, ID-based hydration |
| UI | Flex/grid rules, prop design, conditional rendering |

For any moved, renamed, or newly created file, run `ls` on the file's parent,
grandparent, and further ancestors until you reach a level where the directory
names make the organizing principle obvious. Read what else lives at each level.
A good placement rule explains the whole visible structure, not just the one
file that changed — if the rule only describes one folder, it is probably still
an instance of a more general rule waiting to be written.

---

## 3. Assess confidence via Augment

For every candidate, run **3 Augment queries with different phrasings**.
Request 5 results per query. Collect all snippets before assessing.

Example for a lesson about type casting:
- Query 1: `"as unknown as type cast TypeScript"`
- Query 2: `"double cast force type assertion"`
- Query 3: `"type error wrong source fix"`

**If a query returns 0 or irrelevant results:**
1. Rephrase with different terminology and retry once
2. If still no results, note the failed query and continue with remaining results
3. Never mark a lesson UNVERIFIED without having tried at least 3 distinct queries

**Confidence levels:**

Augment verification is **mandatory** for any confidence above LOW. Diff evidence
(removals, replacements) is supporting signal only — it cannot substitute for
independent Augment confirmation.

| Level  | Criteria |
|--------|----------|
| HIGH   | 5+ distinct snippets across Augment queries confirming the pattern exists broadly in the codebase. Diff evidence is supporting signal only — it cannot substitute for Augment confirmation. |
| MEDIUM | 2–4 snippets from Augment queries, OR 1 snippet AND an explicit removal/replacement in the diff. Diff-only evidence with 0 Augment results = LOW regardless of how clear the correction is. |
| LOW    | 0–1 Augment snippets. Pattern may be valid but lacks independent codebase confirmation. |

**For structural lessons** (folder placement, file naming, region conventions,
file-to-folder conversions), Augment semantic search is insufficient alone.
Also run a targeted bash search to confirm frequency:

```bash
find . -type f \( -name "*.ts" -o -name "*.tsx" \) | \
  xargs grep -l "[pattern]" 2>/dev/null | head -20
```

Structural lesson confidence requires both Augment signal AND grep confirmation
of at least 3 matching files. Without grep, cap at LOW regardless of Augment results.

For multi-commit input, cross-commit recurrence overrides the above:
2+ commits → elevate one level. 3+ commits → always HIGH.

**Pre-existing convention check:** if Augment returns 5+ snippets for a pattern
not touched by this commit, it is already an established convention:
- Already in store → strengthen, do not propose as new
- Not in store → propose as HIGH confidence, note it is pre-existing

---

## 4. Lesson format

Every lesson must be saved using this exact format. No exceptions.

```
[v1] {layer: [frontend|backend|shared]} {scope: [react|parse|ts-universal|domain-model]} {confidence: [high|medium|low]} {intent: enforce}? {source: [BRC-XXXX or commit hash]}
Title: [3–5 words]
Rule: [the full actionable instruction]
Evidence: [one concrete example from the diff]
```

**Choosing layer and scope:**

| Layer | When to use |
|-------|-------------|
| `frontend` | app/client/web specific — React, MUI, Redux |
| `backend` | sms/server specific — Parse, Node, API design |
| `shared` | Applies across both layers |

| Scope | When to use |
|-------|-------------|
| `react` | React/component-specific — ignore in backend sessions |
| `parse` | Parse platform specific — ignore in frontend sessions |
| `ts-universal` | General TypeScript — relevant everywhere |
| `domain-model` | How orders/events/classes are represented — relevant everywhere |

**Format constraints:**
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

---

## 5. Dedup

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

```
[N] HIGH · frontend · react
Title: Region MODEL for store hydration only
Rule:  #region MODEL is reserved exclusively for bring*/selector calls that load
       domain objects from the Redux store. Never use it for prop destructuring
       or generic setup.
Evidence: Helder moved generic setup out of MODEL in the requirement controller.
Format:  [v1] {layer: frontend} {scope: react} {confidence: high} {intent: enforce}? {source: BRC-8574}
Augment: 4 snippets across 3 queries confirming this pattern
Source:  removal/replacement
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
New:    N (X high, Y medium)
Strengthened: M
Revisions:    P
Watchlisted:  Q
Reinforcement ratio: M/(N+M) = R%
```

**Stop here.** Wait for content approval. Nothing executes until section 7.

- To approve all: "save"
- To approve selectively: "save 1, 3, 5"
- To promote a LOW lesson immediately: "promote [title]"
  Saves at LOW confidence as a regular lesson — applied based on evidence strength.
- To enforce a LOW lesson as a team directive: "enforce [title]"
  Saves with {intent: enforce} — confidence stays LOW but the rule is applied as
  a hard rule in future sessions regardless of confidence. Use promote when the
  evidence justifies saving despite LOW; use enforce when it is a team decision
  independent of evidence.
- To reword before saving: edit inline, then confirm

---

## 7. Save

Show a dry run before executing — titles only, full content already approved:

```
Ready to execute:
  SAVES (N): 'title 1' {intent: enforce}, 'title 2'
  STRENGTHENS (M): mem_xxx 'title'
  REVISIONS (P):  mem_xxx → 'new title'
  WATCHLIST:      N entries

Confirm with 'save' or 'save title1, title3'
```

On confirmation, execute in this order:
1. Saves: memory_save(type="pattern") for each — include {intent: enforce}
   in the content string for any lesson promoted via "enforce [title]"
2. Strengthens: `lesson-strengthen` for each
3. Revisions: `forget` old ID → `memory_save` new content
4. Watchlist: `memory_save(type="watchlist", content=[array of descriptions])`

---

## 8. Verify

```bash
curl -s http://localhost:3111/agentmemory/memories
```

Confirm:
- Total count increased by exactly N saves, plus 1 if a watchlist entry was added
- Each new mem ID is present in the response
- Saved content matches approved text exactly — not truncated

**If count is wrong:**
1. Identify which mem IDs from the save calls are absent
2. Retry those saves once
3. If retry fails, output: `MANUAL SAVE NEEDED: memory_save(type='pattern', content='...')`

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
