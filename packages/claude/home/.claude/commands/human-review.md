# Review Run

You are performing a human-simulation review of an automated lesson extraction
pipeline. The pipeline ran on a commit diff and produced a proposed save batch.
You are the last gate before anything is written to the memory store.

**Hard constraints — enforced throughout, not just at the start:**

- Work only from the run output in $ARGUMENTS. No codebase access.
- Do not attempt Augment queries, grep, or any external verification.
- Do not rewrite lessons from scratch — suggest targeted wording changes only.
- Do not defer judgment — produce a concrete verdict on every lesson.
- Be concise. Each verdict is one line. Each reason is one sentence.
  If you find yourself writing a paragraph, compress it. The developer
  has already read the full run output — they need your judgment, not a summary.

---

## Team context

TypeScript/React frontend (app/client/web) and Node/Parse backend (sms/server)
monorepo. The tech lead is Helder — his commits and PR comments are the
highest-authority signal for conventions. Domain model centers on Orders,
Events, Classes (Template, Publication, Mission, Slot, Requirement, User).
Redux for state with Setup/DEFAULT_SETUP/RESET_SETUP per controller. MUI for UI.
Large codebase with significant legacy tech debt.

**A good lesson** — something a competent TypeScript/React developer would get
wrong without being told. Specific to how this team structures code. Actionable
in 5 seconds: read it, know what to do differently.

**A bad lesson** — restates a well-known principle. So specific to one file
it will never apply again. Worded so abstractly it gives no clear action.

---

## Memory schema

```
[v1] {layer} {scope} {confidence} {intent?} {source}
Title: [3–5 words]
Rule:  [full actionable instruction]
Evidence: [concrete example from the diff]
```

**layer:** `frontend` | `backend` | `shared`
**scope:** `react` | `parse` | `ts-universal` | `domain-model`
**confidence:** `high` | `medium` | `low`
**intent: enforce** — hard rule in all new code. Flag violations as tech debt.

Applied in future sessions:

- `high` / `medium`, no enforce → strong guidance
- `low`, no enforce → suggestion
- any confidence + `{intent: enforce}` → hard rule, never deviate

---

## What the pipeline was supposed to do

**learn-from-commits** extracts candidates and assigns confidence:

| Level  | Required evidence                                                                                                                  |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| HIGH   | 5+ snippets across ≥2 of 3 Augment queries. Diff evidence = supporting signal only. Structural lessons also require grep ≥3 files. |
| MEDIUM | 2–4 snippets, OR 1 snippet + explicit diff removal/replacement. Diff-only = LOW regardless.                                        |
| LOW    | 0–1 snippets.                                                                                                                      |

**challenge-learning** re-verifies on five attack vectors:

1. Evidence — re-runs key Augment query fresh (not cached)
2. Causality — correctly attributes the change?
3. Generalizability — survives the next 10 commits?
4. Scope tags — layer/scope correctly assigned?
5. Enforce legitimacy — justified by at least one of:
   - ≤2% violation rate in codebase (near-universal adoption)
   - Explicit documented convention (README, AGENTS.md, recipe file)
   - Deliberate standardization: 3+ files fixed with the same change in one commit

---

## Known pipeline failure modes

Match each adversarial verdict against these patterns. Cite the failure mode
by name when flagging a verdict.

**Extraction pass:**

- **Over-generalization** — one instance stated as universal convention.
  _Example: "Place order by scope class" proposed as HIGH enforce when grep
  found 179 violations._
- **Consequence conflation** — lesson is a side effect of another lesson,
  not independently actionable.
  _Example: "Remove as-cast" kept when it was purely a consequence of the
  named-alias lesson._
- **Enforce inflation** — enforce assigned because a commit touched 3+ files,
  without checking the violation rate in the rest of the codebase.
  _Example: "Re-guard role in handlers" proposed as enforce when 98% of
  handlers did not follow the pattern._

**Adversarial pass:**

- **Current-code blindness** — checker looked at current code (post-commit)
  instead of the diff for causality, missing what was removed.
  _Example: checker marked "Record intersection eliminates casts" as UNRESOLVED
  because the casts were already gone from the current file._
- **Evidence-domain confusion** — downgraded scope from ts-universal to
  domain-model because the evidence was domain-specific, even though the
  rule itself requires no domain knowledge.
  _Example: "Named alias for repeated types" incorrectly retagged to
  domain-model when the rule applies to any TypeScript codebase._
- **Technical-over-practical** — found a technically valid objection that
  misses why the lesson is useful in practice.
  _Example: "mergeSx" rejected because the "silent drop" causality claim
  was imprecise, even though the cascade-ordering value is real._
- **Imprecise count downgrade** — "12+" notation triggered automatic
  confidence downgrade when the actual count was sufficient.
- **Layer over-correction** — changed `shared` → `frontend` without
  verifying the pattern is absent from sms/server.
- **Contradiction mismatch** — violation count from the adversarial pass
  conflicts with the grep result in the confidence audit table.
  _Example: adversarial reported "60% violations" but confidence sub-agent
  had reported 0 surviving anti-patterns._

---

## Your review

**What good output looks like:** Each section is scannable in under 2 minutes.
Verdicts are one line. Reasons are one sentence. Concrete, not hedged.

---

### Section 1 — Signal vs noise

_Work only from run output. Produce a concrete verdict on every lesson._

For each proposed lesson (after adversarial revisions), evaluate two
independent dimensions:

**(a) Content** — Is this genuinely non-obvious to a competent developer on
this team? Or does it restate something they already know?

- ✅ NON-OBVIOUS | ⚠️ BORDERLINE | ❌ OBVIOUS

**(b) Wording** — Would a developer recall and apply this rule while coding?
Or is it too abstract, too long, or too jargon-heavy to be actionable?

- ✅ USABLE | ⚠️ NEEDS SHARPENING | ❌ UNUSABLE

For any ⚠️ or ❌, give a one-sentence fix targeting the specific dimension
that failed. Content fixes change what the rule says. Wording fixes change
how it says it.

---

### Section 2 — Enforce sanity check

_Work only from run output. Produce a concrete verdict on every enforce lesson._

For every `{intent: enforce}` lesson, check three things from the run output:

1. **Adoption rate** — is a violation rate or grep count cited? Does it
   show ≤2% violations?
2. **Documentation** — was AGENTS.md, README, or a recipe file cited?
3. **Standardization signal** — did the commit fix 3+ files with the same change?

Then cross-check: does the adversarial violation count match the confidence
sub-agent's grep result in the audit table? If they contradict each other,
flag as NUMBER CONFLICT — one pass ran a different query.

Verdict per enforce lesson:

- ✅ JUSTIFIED — at least one criterion clearly met, numbers consistent
- ⚠️ PREMATURE — criteria marginal; state which condition is weak
- ❌ OVERREACHING — criteria not met; enforce should be removed
- 🔢 NUMBER CONFLICT — violation counts contradict within the run

If the adversarial pass removed enforce, check whether that removal was
correct or dismissed valid evidence.

---

### Section 3 — Adversarial verdict review

_Work only from run output. Cite the failure mode by name._

For each adversarial verdict, produce:

```
[N] "title" — [AGREE / TOO AGGRESSIVE / TOO LENIENT / WRONG FAILURE MODE / UNCLEAR]
Failure mode: [name from the list above, or "none"]
Evidence: [quote or data point from run output supporting your assessment]
Recommendation: [one sentence — what should change, if anything]
```

UNCLEAR means the run output does not contain enough information to evaluate
this verdict. State specifically what is missing.

---

### Section 4 — Watchlist assessment

_Work only from run output. Note whether each entry is new this run or pre-existing._

For each watchlist entry:

```
"title" — [new this run / pre-existing (age: X days or UNKNOWN)]
Verdict: [✅ WORTH WATCHING / ⚠️ DESCRIPTION UNCLEAR / ❌ TOO NARROW]
Reason: [one sentence]
Fix (if ⚠️): [clearer description]
Evidence to change verdict (if ❌): [what would justify promoting this]
```

Pre-existing entries with UNKNOWN age: flag explicitly — age is required
to evaluate staleness and the run output should include it.

---

### Section 5 — Prompt improvement log

_Only issues that would change the save/reject outcome of a lesson if fixed.
No cosmetic or efficiency issues. Maximum 5, ranked by impact._

```
Priority: [1–5, where 1 = highest impact]
File: [learn-from-commits.md / challenge-learning.md / review-run.md]
Section: [section number or name]
Issue: [what went wrong — cite lesson number from this run]
Fix: [exact instruction to add or change — one sentence]
```

---

### Section 6 — Save recommendations

_One block per lesson. Include all lessons: confirmed, revised, watchlisted, rejected._

```
[N] "title"
Verdict: [SAVE AS PROPOSED / SAVE WITH REWORD / DOWNGRADE CONFIDENCE /
          REMOVE ENFORCE / WATCHLIST / DROP /
          OVERRIDE WATCHLIST TO SAVE / OVERRIDE REJECT TO SAVE]
Reason: [one sentence]
Reword (if applicable): [new Rule text only — keep Title, Evidence, Format unchanged]
Claude Code command: [exact text to type — from translation guide below]
```

---

### Section 7 — Pipeline scorecard

```
Extraction:     N/N candidates were legitimate
Adversarial:    N/N verdicts were correct
Enforce:        N/N enforce assignments justified after your review
Lesson quality: N/N lessons worth saving as-is or with minor revision

Trust level: [HIGH / MEDIUM / LOW]
  HIGH   — ≥80% lessons correct, 0 enforce overreaches
  MEDIUM — 60–80% correct, or 1–2 enforce overreaches
  LOW    — <60% correct, or 3+ enforce overreaches, or a REJECT was missed

Most important prompt fix for next run:  [one sentence]
Most important decision right now:       [one sentence — what needs human judgment]
```

---

## Translating verdicts to Claude Code commands

| Verdict                     | Claude Code command                                                   |
| --------------------------- | --------------------------------------------------------------------- |
| SAVE AS PROPOSED            | `save` or `save 1, 3, 5` for selective                                |
| SAVE WITH REWORD            | Edit inline in Claude Code, then `save`                               |
| DOWNGRADE CONFIDENCE        | `override [N] medium` or `override [N] low`                           |
| REMOVE ENFORCE              | `override [N] remove enforce`                                         |
| WATCHLIST                   | Included automatically when you `save`                                |
| DROP                        | `override [N] drop`                                                   |
| OVERRIDE WATCHLIST TO SAVE  | `promote [title]` or `enforce [title]`                                |
| OVERRIDE ADVERSARIAL REJECT | `override [N] save`                                                   |
| RESOLVE UNRESOLVED          | `resolve [N] [your reasoning]`                                        |
| STRENGTHEN EXISTING         | Direct curl (no Claude Code command):                                 |
|                             | `curl -s -X POST http://localhost:3111/agentmemory/lesson-strengthen` |
|                             | `-H "Content-Type: application/json" -d '{"memId": "mem_xxx"}'`       |

---

## Run output

$ARGUMENTS
