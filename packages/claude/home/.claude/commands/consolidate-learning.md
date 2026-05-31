Consolidate the learn-from-commits + challenge-learning cycle: process user
feedback, decide what to save, refine the cycle prompts. The user has
already seen the proposed lessons and adversarial verdicts; this command
applies their response with due-diligence challenges.

---

## Input

`$ARGUMENTS` contains one or both of:
- The output of an external review pass (e.g. claude.ai meta-review) —
  optional context grounding the user's decisions
- The user's verdicts, pushbacks, and proposed prompt fixes

Each user item is implicitly **suggested** unless marked **mandatory**.
Mandatory items are applied without challenge; suggested items are
challenged.

---

## 0. Preflight

- `pwd` must contain `bruce`.
- curl -s http://localhost:3111/agentmemory/health | jq -r '.status'
- A prior learn-from-commits run must exist in this conversation. If
  not: "STOPPED: no learn-from-commits findings to consolidate."

---

## 1. Parse and record prior position

For each item in $ARGUMENTS, output one line:

```
[N] [mandatory | suggested] — [item summary]
```

Before reading section 2, write your **prior position** on each
suggested item in one line — what you would do without user input. This
anchors honest challenge instead of post-hoc rationalization.

---

## 2. Challenge suggested items

Apply the rigor of challenge-learning attack vectors. For each suggested
item:

- Verify checkable claims (violation rates, scope, file existence) with
  grep or Augment. Do not trust unverified counts.
- Distinguish adoption rate from violation rate — they are not the same.
- Distinguish stylistic from substantive objections. If a reword changes
  wording without changing behavior, accept it; do not relitigate.
- If the user's position holds, adopt it. If it does not, state the
  counter-argument in ≤3 sentences and keep your prior position.

**Tech lead override:** if the user explicitly cites a PR comment or
direct statement from the tech lead, treat the item as mandatory
regardless of how it was marked. Cited directives bypass evidence
challenge. Vague recall ("I think they said…") does not qualify.

For mandatory items, apply without challenge. If you would have pushed
back, capture the objection for the postmortem.

---

## 3. Execute saves

Show a dry run, then save. Order: patterns → strengthens → revisions →
watchlist (as `type="fact"`). Include `{intent: enforce}` in the content
string for enforced lessons. For watchlist entries promoted from a prior session,
include the original `created_at` date so staleness is visible. After each save,
run `memory_smart_search` by title and confirm the returned mem ID appears.

---

## 4. Refine prompts

Apply user-proposed prompt fixes only after passing them through section
2. If the file is a symlink, resolve via `readlink -f` and edit the real
target.

**Concision rules — non-negotiable:**

1. The prompt is a behavior spec, not a tutorial. Do not include prose
   explaining WHY a rule exists unless its absence would let a future
   reader misapply the rule.
2. No examples unless the rule is genuinely ambiguous without one. When
   you do include an example, one is enough.
3. No restating constraints that already appear elsewhere in the file.
4. Prefer principles over enumerations. "Verify checkable claims" beats
   a checklist of which claims are checkable.
5. If a sentence describes a decision the prompt has already made,
   delete it.

**Iteration loop (run silently, do not show drafts):**

a. Draft the edit.
b. For each added sentence, ask: would removing it change what the next
   reader does? If no, remove.
c. Repeat (b) until no sentence fails the test.
d. Final pass: if you added more than ~15 lines per logical change, you
   have prose to cut.

Apply the final, trimmed edits in one pass. Do not narrate the
iterations in the conversation.

---

## 5. Postmortem

Output exactly this block:

```
Saved (N):
  mem_xxx — "title" [enforce?]
  ...

Rejected from user proposal (N):
  [N] "item" — [≤1 sentence reason]

Mandatory-applied without challenge (N):
  [N] "item" — [the objection you would have raised, or "no objection"]

Prompt edits (file:lines):
  path:start-end — [≤1 sentence change description]
    Before: [replaced text, ≤1 line — "(new section)" if pure addition]
    After:  [new text, ≤1 line — "(deleted)" if pure removal]
  ...

Process note (optional):
  [one sentence on what this cycle revealed about the workflow itself,
   if anything actionable]
```

Stop. No further explanation unless the user asks.

---

$ARGUMENTS
