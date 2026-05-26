Audit every coding lesson saved in agentmemory for this project. Produce a
verdict for each one, then wait for approval before changing anything.

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

Read every lesson fully, noting the saved date of each where available.

**Watchlist:** check for any entry with `type="watchlist"`. If found, extract
each description and add it to the evaluation queue — these will be tested
against Augment to determine if they can be promoted to `type="pattern"`.

Output before proceeding:

```
Loaded:    N lessons (oldest: [date], newest: [date])
Watchlist: K entries queued for promotion evaluation
Note:      [flag if this immediately follows learn-from-commits — Augment
            index may not reflect the latest commit; weight agentmemory
            evidence higher than Augment for lessons saved today]
```

---

## 2. Ground via Augment

Identify the top 3 themes across all loaded lessons.

For each theme, run **3 Augment queries with different phrasings** and request
5 results per query. Collect all snippets before evaluating anything.

Example for a theme about type design:
- Query 1: `"TypeScript type alias Recorded wrapper"`
- Query 2: `"avoid unnecessary type definition"`
- Query 3: `"base type reuse instead of alias"`

**If a query returns 0 or irrelevant results:**
1. Rephrase with different terminology and retry once
2. If still no results, note the failed query and continue
3. Never mark a lesson UNVERIFIED without having tried at least 3 distinct queries

**Watchlist promotion:** for each watchlisted entry, run 3 queries. If found in
2+ snippets across queries → add to evaluation queue as HIGH confidence.
If still 0 results → keep in watchlist, do not promote yet.

Output per theme:

```
Theme 1: [name]
  Query 1 '[query]': X results — [relevant / irrelevant]
  Query 2 '[query]': X results — [relevant / irrelevant]
  Query 3 '[query]': X results — [relevant / irrelevant]
  Usable snippets: X total
```

---

## 3. Evaluate

Apply these four criteria to every lesson. Combine them into one final verdict.

**Accuracy** — compare against Augment snippets from section 2:

| Augment evidence | Verdict |
|-----------------|---------|
| Pattern confirmed in 3+ snippets | Accurate |
| Pattern confirmed in 1–2 snippets | Probably accurate — note uncertainty |
| Pattern contradicted by snippets | Inaccurate → ❌ DELETE |
| 0 relevant snippets, lesson older than 30 days | Presumed accurate by age → ✅ KEEP with note |
| 0 relevant snippets, lesson newer than 30 days | → 🔍 UNVERIFIED |

**Specificity** — is it actionable without additional context?

- Concrete trigger, action, and reason → specific ✅
- Vague principle with no decision trigger → ⚠️ REVISE
- References a specific filename or variable name → fragile → ⚠️ REVISE to generalize

**Uniqueness** — compare every lesson against every other:

- Same principle, different wording → merge into the stronger wording, ❌ DELETE weaker
  (use Augment snippet language to determine which wording is stronger)
- Same topic, genuinely different rule → ✅ KEEP both, note relationship
- Subset of another lesson → absorb into parent, ❌ DELETE subset

After evaluating all lessons individually, do a **pairwise scan** of all KEEP
and REVISE verdicts. Flag any two lessons that prescribe opposite behavior for
the same situation as: ⚠️ INTERNAL CONTRADICTION mem_xxx vs mem_yyy

**Durability** — will this survive normal codebase evolution?

- References a pattern or principle → durable ✅
- References a specific path, component name, or variable → fragile → ⚠️ REVISE

**Final verdicts:**

| Verdict | Meaning |
|---------|---------|
| ✅ KEEP | Accurate, specific, unique, durable |
| ⚠️ REVISE | Correct principle — needs rewrite |
| ❌ DELETE | Inaccurate or fully absorbed by another lesson |
| 🔍 UNVERIFIED | 0 Augment results, lesson under 30 days — kept pending your input |

---

## 4. Present

Group output by verdict. Show full content for every lesson — never truncate.

**✅ KEEP:**
```
mem_xxx — "title" [age: X days]
Content: [full text]
Augment: X snippets confirming pattern
Reason:  [confirmed by snippets / presumed accurate by age / relationship to other lessons]
```

**⚠️ REVISE:**
```
mem_xxx — "title" [age: X days]
Content:  [full current text]
Issue:    [vague / fragile / overlaps with mem_yyy / internal contradiction with mem_zzz]
Proposed: [full replacement text]
Augment:  [which snippets informed the rewrite]
```

**❌ DELETE:**
```
mem_xxx — "title" [age: X days]
Content: [full text]
Reason:  [contradicted by X snippets / absorbed into mem_yyy]
```

**🔍 UNVERIFIED:**
```
mem_xxx — "title" [age: X days]
Content: [full text]
Queries tried: ['query 1', 'query 2', 'query 3'] — all returned 0 relevant results
Kept by default.
To resolve: "verify mem_xxx against [file]" or "delete mem_xxx"
```

**⚠️ Internal contradictions:**
```
mem_xxx — "title" vs mem_yyy — "title"
Conflict:        [what they disagree on]
Recommendation:  [which to keep and why, based on Augment evidence]
Resolve now: reply "keep mem_xxx" or "keep mem_yyy"
```

**💡 Gaps** (patterns visible in Augment snippets with no corresponding lesson):
Max 3, only if clearly absent. These are LOW confidence hypotheses with no
commit evidence — do not format as ready-to-save rules. List as observations:
> "No lesson covers [pattern] — seen in X snippets across [theme] queries."

**Watchlist promotions:**
```
✅ PROMOTE — "title" — found in X snippets, ready to save as pattern
⏳ KEEP WATCHING — "title" — still 0 results, not promoted
```

**Summary:**
```
Total:    N lessons
Verdicts: X keep | Y revise | Z delete | W unverified
Internal contradictions: [count]
Watchlist: P promoted | Q still pending
Gaps found: K

Store health: (X+Y)/N% correctable | Z/N% problematic
Coverage:    [strong — 0 gaps | partial — 1–2 gaps | weak — 3 gaps]
```

**Stop here.** Wait for approval. Nothing changes until you say "apply".

- For UNVERIFIED: say `"verify mem_xxx against [file]"` or `"delete mem_xxx"`
- For gaps: say `"save [description]"` to add to watchlist
- For contradictions: say `"keep mem_xxx"` to resolve

---

## 5. Apply

Execute approved operations in this exact order to avoid double-deletes:

**1. Standalone deletes:**
```bash
curl -s -X POST http://localhost:3111/agentmemory/forget \
  -H "Content-Type: application/json" \
  -d '{"memId": "mem_xxx"}'
```

**2. Revisions** (delete old entry first, then save new):
`forget(mem_xxx)` → `memory_save(type="pattern", content="[approved rewrite]")`

**3. Watchlist promotions** (delete old watchlist entry, save promoted lesson,
re-save remaining unwatchlisted entries):
`forget(mem_watchlist_id)` →
`memory_save(type="pattern", content="[promoted lesson]")` →
`memory_save(type="watchlist", content=[remaining entries])`

**4. New watchlist entries** (from approved gaps):
`memory_save(type="watchlist", content="[description]")`

---

## 6. Verify

```bash
curl -s http://localhost:3111/agentmemory/memories
```

Confirm:
- Standalone deleted IDs are absent
- Revision old IDs are absent, new IDs present with correct content
- Promoted watchlist lessons appear as `type="pattern"`
- Remaining watchlist entry contains only un-promoted items
- Count arithmetic is correct across all operations

**If count is wrong:**
1. Identify the discrepancy
2. Retry the failed operation once
3. If retry fails: `MANUAL ACTION NEEDED: [operation] [full content]`

**Final output:**

```
✅ mem_xxx — "title" — kept
⚠️ mem_xxx → mem_yyy — "title" — revised
❌ mem_xxx — "title" — deleted
🔍 mem_xxx — "title" — unverified, kept, no action taken
💡 mem_xxx — "title" — gap added to watchlist
📋 mem_xxx — "title" — promoted from watchlist to pattern

Audit complete. Store: N total | Kept X | Revised Y | Deleted Z | Promoted W | Watchlisted V
```

---

$ARGUMENTS
