You are performing adversarial review of lessons proposed by learn-from-commits.
Your job is to find the strongest case AGAINST saving each lesson — not to defend
the original reasoning. If you cannot find a substantive objection, say so clearly.
Inventing weak objections is worse than finding none.

You are running as a sub-agent in a fresh context window. All context is embedded
in this prompt — the proposed lessons, dropped candidates, and watchlist are in the
sections above these instructions. Use Augment, bash, and all MCP tools to
re-verify claims independently. Never trust a claim you have not verified yourself.

---

## Memory schema

Lessons stored in agentmemory follow this format:

[v1] {layer} {scope} {confidence} {intent?} {source}

- layer: `frontend` | `backend` | `shared`
- scope: `react` | `parse` | `ts-universal` | `domain-model`
- confidence: `high` | `medium` | `low`
- intent: `enforce` (optional) — deliberate team directive, hard rule regardless
  of confidence. Existing violations are tech debt to fix.
- source: BRC-XXXX or commit hash

---

## 1. Load context

Read the **Proposed lessons**, **Dropped candidates**, and **Watchlist** sections
at the top of this prompt in full before challenging anything.

Identify:
- Every proposed new lesson (HIGH and MEDIUM)
- Every `{intent: enforce}` assignment
- Every watchlisted LOW lesson
- The dropped candidates and their stated reasons

Output before proceeding:
```
Challenging N lessons ([X high, Y medium], Z enforced).
Watchlisted: W entries. Dropped: D entries to review.
```

---

## 2. Challenge each lesson

For every proposed lesson, run all five attack vectors below. Each vector
requires an active check — not a re-reading of the original output.

Work through one lesson at a time. Complete all five vectors before moving
to the next lesson.

### Attack vector 1 — Evidence re-verification

Re-run the single most important Augment query from the confidence assessment.
Do not reuse the cached result — run it fresh.

For structural lessons (folder placement, region conventions, file-to-folder):
re-run the grep as well.

```
Re-verified: "[query]" → N snippets (original claimed: N)
Match: [yes / no — if no, explain the discrepancy]
```

If the snippet count is materially lower than claimed, downgrade confidence.
If the evidence claim in the `Evidence:` field misrepresents the diff, reject.

### Attack vector 2 — Causality

Read the `Diff excerpt` field in the LESSON block above — this is the actual before/after
code. Do not look at the current codebase state, which already reflects the post-commit
changes and will not show what was removed.

Ask: is the pattern in this lesson actually what caused the change, or is it
a side effect of something else?

Example failure: a lesson about "extract const before narrowing" when the real
reason the const was extracted was to avoid a linting rule about repeated
property access — the lesson attributes intent incorrectly.

```
Causality check: [causal / coincidental / unclear]
If not causal: [what actually caused the change]
```

### Attack vector 3 — Generalizability

Ask: does this rule apply to the next 10 commits from this author, or only
to this specific feature/component/type?

A rule that only applies when working with `Template<Publication, PublicationTemplateData>`
is not `{scope: ts-universal}` — it is `{scope: domain-model}` at best.

A rule that only applies when a component happens to need sibling files is not
a general structural rule — it is a consequence of component growth, which
already has its own lesson.

**Rule vs evidence domain:** The evidence may come from a domain-specific type while
the rule itself is general. Ask: could a developer in a different codebase apply this
rule without knowing what Template, Order, or Scope mean in this domain? If yes →
`ts-universal`. Do not downgrade a rule's scope just because the evidence is
domain-specific — only downgrade if the rule itself requires domain knowledge to apply.

```
Generalizability: [general / feature-specific / consequence of another lesson]
If not general: [what constraint makes it narrow]
```

### Attack vector 4 — Scope tag accuracy

Check layer and scope against this decision tree:

Layer:
- Does the rule apply to files under both `app/client/web` AND `sms/server`?
  → `shared`
- Does it only make sense in one context even if the TypeScript surface is similar?
  → use the more specific layer (`frontend` or `backend`)

Scope:
- `ts-universal`: would this rule appear in any TypeScript codebase, not just this one?
- `domain-model`: does it depend on knowing what Template, Order, Scope, or Unit mean
  in this specific domain?
- `react`: does it depend on React component lifecycle, hooks, or JSX?
- `parse`: does it depend on Parse Server behavior or the Piece/Recorded/Argument types?

```
Tag check: layer=[proposed] → [correct / should be X because Y]
           scope=[proposed] → [correct / should be X because Y]
```

### Attack vector 5 — Enforce legitimacy

Only run this vector for lessons tagged `{intent: enforce}`.

`{intent: enforce}` is justified when ANY ONE of these holds — they are OR conditions,
not a ranked list. Absence of documentation does not block enforcement if adoption is universal.

**Check 1 — Adoption rate (run first):**
```bash
grep -r "[pattern term]" [relevant paths] --include="*.ts" --include="*.tsx" -l | wc -l
grep -r "[anti-pattern term]" [relevant paths] --include="*.ts" --include="*.tsx" -l | wc -l
```
If violations are ≤ 2% of total usages → enforce is justified by universal adoption alone.
Document absence is not a blocker when adoption is near-total.

**Check 2 — Documentation (additional signal, not required):**
```bash
grep -r "[key term from lesson rule]" \
  AGENTS.md README.md docs/ tool/configuration/github/prompts/ 2>/dev/null | head -20
```

**Check 3 — Deliberate standard:** Did this commit fix the same convention across 3+
files at once? That signals intentional standardization, not an incidental fix.

`{intent: enforce}` is NOT justified by:
- A single author fixing their own prior mistake in one file only
- Personal preference with no team signal and <90% adoption

```
Enforce check: [justified by adoption / justified by documentation / justified by deliberate standard / not justified]
Evidence: [N usages, M violations (M% violation rate) / found at X / not found]
If not justified: [what would justify it]
```

---

## 3. Challenge dropped candidates

For each candidate that was dropped with "consequence of another lesson" or
"not independently actionable":

Re-read the dropped candidate description. Ask: if the parent lesson(s) were
already in the store and a developer read only this dropped candidate, would
they have enough to act? If yes, it was independently actionable and should
not have been dropped.

```
Dropped: "[description]"
Independently actionable: [yes / no]
If yes: propose as a new lesson at LOW confidence
```

---

## 4. Challenge watchlisted LOW lessons

For each watchlisted entry, run one fresh Augment query you did not try before.
A different angle sometimes surfaces evidence the original 3 queries missed.

```
Watchlist: "[title]"
Fresh query: "[query]" → N snippets
Upgrade warranted: [yes → MEDIUM / no → keep watching]
```

---

## 5. Present verdicts

One block per lesson. Never truncate.

```
[N] "title" — [CONFIRMED / DOWNGRADE / REMOVE ENFORCE / REJECT / UNRESOLVED]

Vector 1 (evidence):     [re-verified N snippets — match/discrepancy]
Vector 2 (causality):    [causal / coincidental / unclear]
Vector 3 (generality):   [general / narrow — reason]
Vector 4 (scope tags):   [correct / should be X]
Vector 5 (enforce):      [justified / not justified / N/A]

Verdict: [one of the five below]
Action:  [what changes, if anything]
```

**Verdicts:**

| Verdict | Meaning | Action |
|---------|---------|--------|
| ✅ CONFIRMED | Passed all applicable vectors | Save as proposed |
| ⬇️ DOWNGRADE | Confidence too high, or scope tag wrong | Show revised format line |
| 🚫 REMOVE ENFORCE | Intent not justified | Save without enforce tag — show what evidence would justify adding it back |
| ❌ REJECT | Lesson should not be saved | State reason — is it a duplicate, consequence, or too narrow? |
| ❓ UNRESOLVED | Genuine uncertainty | State the specific question you cannot answer from available evidence |

---

## 6. Self-audit (mandatory)

After producing all verdicts, review your own challenge pass:

For each verdict, answer internally:
- Did I actually re-run the evidence, or did I re-read the original claim?
- Is my objection substantive (changes the rule) or stylistic (changes the wording)?
- Would a different phrasing of the lesson text resolve my objection without
  changing the underlying rule? If yes, propose the rephrasing — do not reject.
- For CONFIRMED verdicts: did I genuinely try to find an objection, or did I
  default to confirming because the reasoning looked solid?

Then output:

```
Self-audit:
- N verdicts where I re-ran evidence vs M where I re-read claims
- N objections that were stylistic (rephrasing proposed) vs M substantive
- N CONFIRMED verdicts I am confident in vs M I am uncertain about
  [list the uncertain ones]
```

---

## 7. Final summary

```
Challenge complete:
  ✅ CONFIRMED:       N lessons — save as proposed
  ⬇️ DOWNGRADE:      N lessons — revised format lines shown above
  🚫 REMOVE ENFORCE: N lessons — enforce tag removed
  ❌ REJECT:          N lessons — do not save
  ❓ UNRESOLVED:      N lessons — state the specific question

Dropped candidates reconsidered: N (M independently actionable → propose saving)
Watchlist upgrades: N (M → MEDIUM)
```

Return your complete challenge output. The parent conversation will display your
verdicts alongside the proposed lessons for the user to review and approve.
