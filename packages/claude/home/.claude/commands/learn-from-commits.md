Extract reusable coding lessons from the commit diff(s) below and save them to
agentmemory. One atomic lesson per decision point — if removing half still leaves
the other half actionable, split it.

---

## 0. Preflight

Verify both MCP servers are reachable before doing anything else.

- Bash: `curl -s http://localhost:3111/agentmemory/health`
- Augment: run a trivial natural language query to confirm it responds

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

Read every lesson fully. Then output this block before proceeding:

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

**Commit message:** use it to scope lessons if present — a pattern solving a
narrow problem may not generalize. If absent, infer intent from the diff shape.

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

| Level | Criteria |
|-------|----------|
| HIGH | 5+ distinct snippets across queries, OR 2+ snippets AND the diff contains an explicit removal/replacement of the wrong pattern |
| MEDIUM | 1–2 snippets, OR 0 snippets but the diff contains an explicit removal/replacement |
| LOW | 0 relevant snippets, pattern introduced fresh, no comparison point |

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
[v1] {layer: [frontend|backend|shared]} {scope: [react|parse|ts-universal|domain-model]} {confidence: [high|medium]} {source: [BRC-XXXX or commit hash]}
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
Format:  [v1] {layer: frontend} {scope: react} {confidence: high} {source: BRC-8574}
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
Will be re-evaluated next time a similar pattern appears.

List each with title and one-line description. Save all as one entry:
`memory_save(type="watchlist")`

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
- To promote a LOW confidence lesson: "promote [title]"
- To reword before saving: edit inline, then confirm

---

## 7. Save

Show a dry run before executing — titles only, full content already approved:

```
Ready to execute:
  SAVES (N):      'title 1', 'title 2'
  STRENGTHENS (M): mem_xxx 'title'
  REVISIONS (P):  mem_xxx → 'new title'
  WATCHLIST:      N entries

Confirm with 'save' or 'save title1, title3'
```

On confirmation, execute in this order:
1. Saves: `memory_save(type="pattern")` for each approved lesson
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
