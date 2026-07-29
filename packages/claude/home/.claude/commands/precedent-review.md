# precedent-review.md

Blocking pre-merge review whose unit of work is the **construct**, not the file and not
the checklist section. Every named or shaped thing the diff introduces gets its own
quantified precedent census. Findings are produced by arithmetic, not by taste.

**Usage:** `/precedent-review [ticket context, template hints, or a base ref]`
Default base ref: `development`. Ticket context: $ARGUMENTS

---

## Why this exists (read before deviating)

Checklist reviews fail on **recall**, not precision. Clean, idiomatic, DRY-looking code
passes a "is this good?" read and is exactly where convention drift hides. The only
question that finds drift is "does the rest of this repo do it this way, and in what
proportion?" — a comparison against a second corpus, never answerable by inspection.

Three rules follow, and they override any instinct to be efficient:

1. **Over-enumerate, then census.** You do not get to decide which constructs deserve
   investigation. Enumerate everything; the census decides.
2. **A census outputs a ratio, never a verdict.** "Precedent exists" is not a result.
   `N new : M established` is a result.
3. **Clean-looking code is the expected input.** A census returning no adverse ratio is
   a _result to report as checked_, not a reason to have skipped it.

---

## Phase 0 — Scope and final state

```bash
git diff <base>...HEAD --stat
git log <base>..HEAD --format='%h %an %s%n%b' | grep -E '^(Template:|[0-9a-f]{7} )'
git status --short
```

Then, for every array, list, or ordered block the diff touches, **read the final file
state, not the diff**. A re-sort renders as a replacement in unified diff and will be
misread as a deletion. Record: `path:line — <N items, ordering: alphabetical|other,
added: […], removed: […]>`. Removals must be confirmed absent from the final file.

Output:

```
Scope: N files, +N/-N | Base: <ref>
Domains: …
Re-sorts detected: path:line (nothing removed | removed: …)
```

---

## Phase 1 — Construct enumeration (over-generate; no filtering)

Enumerate every **construct** the diff introduces or alters. A construct is any named
or shaped thing that a reader could have written a different way. Target 3–5× more
candidates than you expect to become findings. **Do not pre-filter for plausibility** —
filtering here is the failure mode this command exists to prevent.

Sweep at minimum:

- **Identifiers** — every new const, function, type, interface, field, prop, helper,
  test fixture, and _local/callback parameter_. One row each.
- **String literals that carry structure** — CSS class names, translation keys and the
  _form_ they take (inline vs indirected), test-id strings, enum-ish codes, magic values.
- **Style shapes** — every `sx` object, style const, style builder, hardcoded color /
  shadow / spacing / transition / media query, and where each _lives_ (inline at the
  element, const in component body, module const, theme override).
- **Structure** — region names and their nesting, file/folder placement, import
  direction, export shape, JSDoc presence and _wording_.
- **Data access** — query `fields` arrays, tenant filters, `bring()` calls, dot-notation
  relation paths, order-input null/undefined coalescing.
- **Tests** — every fixture, helper, query API (`getByRole` vs `getByLabelText` vs bulk
  scrape), interaction API, assertion, and each test's **title-vs-behavior match**.
- **Comments and prose** — every JSDoc line and user-facing string, checked for canonical
  wording against its source of truth.

Output a numbered construct table. `C1 … Cn`. No commentary yet.

```
C1  path:line  <kind>  <the construct, verbatim>
```

---

## Phase 2 — Machine-encoded intent sweep (run once, before censuses)

Convention that is enforced or declared by a config file is the strongest evidence in
the repo and is _never in the diff_. Read these and extract every rule that bears on any
enumerated construct:

```bash
# adapt names to the repo; read them, do not just grep
eslint.config.* .eslintrc*     # ignorePatterns, max-len, naming rules, unused-arg patterns
tsconfig*.json                 # strictness that makes a construct legal/illegal
vitest.config.* jest.config.*  # globals, environment, setup files
package.json                   # the actual gate commands
```

Plus the repo's own declared sources of truth for the domains touched — theme/token
modules, i18n resource files, design-system entry points, generated-schema packages,
`AGENTS.md` / `CLAUDE.md` / `docs/`.

Two things to extract specifically:

- **Accommodations.** A lint exemption written _for_ a particular idiom is proof that
  idiom is intended. (An `ignorePattern` matching `t('…')` proves inline translation keys
  are the sanctioned form.)
- **Stated prohibitions in comments.** A token module saying _"defined to avoid random
  values"_ converts every hardcoded literal of that kind from taste into a contract
  violation.

Output: `Encoded rule → which constructs it bears on (C-ids)`.

---

## Phase 3 — Per-construct census (the core; parallelise)

For **every** `Cn`, produce a census. Never fewer than two searches: one for the new
form, one for the established form. Never accept an existence check.

```bash
# 1. how many sites use the NEW form
# 2. how many sites use the ESTABLISHED form for the same job
# 3. the closest sibling exemplar (same role, same folder depth, most recently touched)
# 4. git log -S '<new form>' -1  → is the precedent one recent commit, or the house style?
```

Mandatory output row per construct — a ratio, never a verdict:

```
Cn  <construct>
    new: N sites (paths)  |  established: M sites  |  ratio M:N
    closest sibling: path:line → uses <form>
    precedent age/author: <sha date author> | none
    encoded rule: <from Phase 2> | none
```

### Polarity check — run BEFORE the threshold rule

A raw ratio is backwards-looking and will invert on any codebase mid-migration. Magnitude
without direction produces confidently wrong findings: it flags the _new correct form_ as
drift because the legacy form still outnumbers it. Establish direction first.

```bash
git log -S '<new form>'         --oneline -5   # when did the new form appear, how often
git log -S '<established form>' --oneline -5   # is the established form still being added?
```

Then check for a **declared migration** away from the majority form — AGENTS.md
"Recent Patterns", `docs/*-migration.md`, deprecation comments, "legacy / reference only"
labels, unmaintained-dependency notes.

| Direction evidence                                                  | Effect on the threshold rule                                                                                                    |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Declared migration _away_ from the majority form                    | **Polarity inverts.** The majority form is legacy; using it is the finding. The minority form is correct at any ratio.          |
| Majority form still added in recent commits, no migration declared  | Ratio stands as written.                                                                                                        |
| Minority form is the only one added recently, no declared migration | Ratio is **suspect** — report as _mixed, direction unclear_, never as SHOULD FIX. Escalate to the polarity adversary (Phase 5). |

State the polarity verdict in every census row. A ratio reported without one is unusable.

### Threshold rule — replaces "matching existing code beats improvement"

Apply mechanically, and only after polarity is established. This exists because a bare
precedent principle is satisfiable at M=1 and silently suppresses real drift.

| Condition                                                    | Outcome                                                    |
| ------------------------------------------------------------ | ---------------------------------------------------------- |
| An encoded rule (Phase 2) contradicts the construct          | **F — MUST/SHOULD FIX**, regardless of ratio               |
| Construct uses a form with a declared migration away from it | **F — SHOULD FIX**, regardless of ratio                    |
| `M:N ≥ 10:1`, polarity confirmed                             | **F — SHOULD FIX** (house style, clearly diverged)         |
| `3:1 ≤ M:N < 10:1`, polarity confirmed                       | **D — divergence opportunity**                             |
| `M:N < 3:1`, or polarity unclear                             | Genuinely mixed — no finding; report as _checked, mixed_   |
| `M = 0` (novel construct)                                    | Judge on merit + AGENTS.md; state that no precedent exists |
| Inherited verbatim from a verified template                  | **D**, with every sibling site listed                      |

A construct whose census you did not run may not be reported as clean. List it under
**Not censused** with the reason.

---

## Phase 4 — Consequence probes

For every construct that becomes a finding, and every fix you propose, probe the
downstream effect before writing it up:

- **Would the fix break a gate?** If inlining/renaming/removing changes line length,
  type inference, or an accessible name, run the narrow gate now. Restructure the fix so
  the gate passes _in the report_, not after review.
- **Do assertions have teeth? Mutation-test them.** Invert the source behavior the test
  claims to protect, run that one test, confirm it fails, restore. An assertion that
  survives its own mutation is a finding regardless of how it reads.
- **Does the claimed target exist?** A proposed token, helper, or exemplar must be read
  and quoted, not assumed. If no token matches, say so and recommend adding one rather
  than substituting a near-miss.
- **Title-vs-behavior.** For every test, state what it _actually_ exercises. Mismatch is
  a finding even when the test passes.

---

## Phase 5 — Adversarial verification (three lanes, asymmetric burden of proof)

Generic "spawn N skeptics to refute each finding" is a **precision** mechanism. This
command's failure mode is **recall**. Bolting on undifferentiated refuters would re-create
the very problem it exists to fix: doubt is cheap, and a reviewer given permission to doubt
returns an empty report. So adversaries here are _differentiated_, and two of the three
lanes attack the **absence** of findings rather than their presence.

**Blindness rule.** Every adversary runs in a fresh context and receives the construct, the
file, and the repo — **never the census conclusion or the proposed severity**. An adversary
shown the answer grades the answer; an adversary shown only the question produces an
independent measurement you can compare against. Prefer "re-measure this" over "do you
agree with this".

### Lane 1 — Adversary against the finding (precision)

For each F candidate, three **diverse lenses** — not three copies of one skeptic. Redundant
refuters agree with each other; diverse ones catch failure modes redundancy cannot.

| Lens            | Charge                                                       | Method                                                                                                                                              |
| --------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Measurement** | The ratio is wrong.                                          | Re-census independently with different patterns, different paths, formatting variants. Try to make `M` collapse or `N` grow. Report your own ratio. |
| **Polarity**    | The diff is the correct direction; the finding is backwards. | Recency of each form, declared migrations, AGENTS.md "Recent Patterns", deprecations, unmaintained deps.                                            |
| **Consequence** | The proposed fix breaks something.                           | Apply it, run the narrow gate, check behavior and design intent. A fix that fails its gate invalidates the finding as written.                      |

**Asymmetric kill rule** — the burden of proof depends on what class of claim it is:

- **MUST FIX** (correctness, security, data loss): strict. Survives only if ≥2 of 3
  adversaries fail to refute, and **uncertainty counts as refuted**. False alarms on
  behavior claims are expensive.
- **SHOULD FIX / D** (convention, backed by a ratio): the ratio _is_ the evidence.
  Refutation requires **producing a counter-measurement** — a different ratio, a declared
  migration, a failed gate. Bare doubt does not refute a count. Uncertainty leaves the
  finding standing, downgraded one severity.

Record each verdict as `CONFIRMED` or `PLAUSIBLE`, with the refuting evidence when killed.
A finding killed by an adversary is reported in a one-line **Killed** list with the reason —
never silently dropped, because a wrongly-killed finding is invisible otherwise.

### Lane 2 — Adversary against the clean verdict (recall — the lane that matters most)

This is the inversion, and it is where the value is. A census can pass for bad reasons and
nothing downstream ever revisits it.

Batch the constructs that passed Phase 3 and charge one adversary per batch:

> These constructs were measured and found conventional. Exactly one of your assumptions is
> wrong. Find the census that measured the wrong thing — searched for the wrong idiom so `M`
> came back high, grepped too narrow a path, matched too literal a pattern, or accepted a
> single recent commit as house style. Name the construct and produce the corrected ratio.

Force a nomination even when the batch looks clean; a forced wrong guess costs one line,
a missed false-negative ships. Any corrected ratio re-enters Phase 3's threshold rule.

### Lane 3 — Adversary against the report (completeness)

Phase 7 is this lane. It attacks neither findings nor clean verdicts but the **shape of the
deliverable** — what was never enumerated, never opened, never probed. Run it after findings
are drafted, never before.

### Cost control

Lane 1 is per-finding and scales with findings; Lane 2 is per-batch and nearly free; Lane 3
is one pass. If budget is tight, cut Lane 1 to a single lens (Measurement) before touching
Lane 2 — **Lane 2 is the lane that reproduces the behavior this command exists for.** Never
drop Lane 2 to afford more Lane 1.

---

## Phase 6 — Gates

Run the repo's verification gate read-only and report verbatim results (lint, typecheck,
tests — from `package.json` / AGENTS.md "Verification"). Known-red failures documented in
memory are filtered and named as filtered; anything else failing is MUST FIX.

---

## Phase 7 — Completeness critic / Lane 3 (mandatory; do not skip when findings look sufficient)

A verdict-shaped report is an attractor. Before writing the summary, answer each
explicitly — these are the categories checklist reviews starve, listed because they are
starved, not because they are minor:

1. Which enumerated constructs were **not** censused? Why?
2. Translations: key form, dead keys, ordering, interpolation mechanism, canonical wording?
3. Styling: hardcoded values vs tokens, and **where the style object lives** vs how the
   repo places equivalent styles?
4. Tests: any assertion not mutation-tested? any bulk-scrape assertion that would pass on
   the wrong field? any title overclaiming its behavior?
5. Naming: does any identifier describe a scope wider or narrower than its actual use
   sites? (Check every call site, not the declaration.)
6. Comments/JSDoc: any wording that forked from its source of truth?
7. Ordering: every touched array/interface/Setup checked against the declared order?
8. Which files did the diff touch that I never opened in final-state form?

Each unanswered item is a stated gap in the report, not silence.

---

## Findings

Verify path, line, and behavior in the file before reporting. Global sequential IDs
`[F1] …` across all files, grouped by file, severity-ordered within file. Every finding
cites its census ratio or its encoded rule — a finding with neither is not reportable.

```
### path/to/file.tsx

[F1] **MUST FIX** [line N] — <finding>
     Evidence: <ratio M:N | encoded rule at config:line>
     Fix: <concrete, gate-verified>
```

Severity: **MUST FIX** bugs / security / data loss / broken behavior · **SHOULD FIX**
convention violation at ratio ≥10:1, missing error handling, test gap, weak assertion ·
**CONSIDER** optional, or below-threshold.

Then `### Divergence opportunities` — `[D1] …`, no severity, never blocking, each listing
every site that would need the same change:

```
[D1] [category] — <improvement and why>
     Sites: path:line, … (grep: "<pattern>")
     Adopt everywhere: N files | Keep parity: no action
```

Then:

```
Censused: N/N constructs | Not censused: N (listed)
Total: N MUST FIX (F…) | N SHOULD FIX (F…) | N CONSIDER (F…) | N DIVERGENCE (D…)
Mutation-tested: N assertions | Gates: lint <r> typecheck <r> tests <r>
```

---

## Standard gaps

Only when a finding has no documentable standard to cite, and the pattern is absent from
both project memory and AGENTS.md:

```
📋 STANDARD GAP: "<title>"
Observed: <what, with census ratio>
Suggested: "When <situation>, always/never <action> because <reason>"
Add to: AGENTS.md | memory watchlist
Confidence: high (3+ instances) | medium (this PR + 1) | low (once)
```

---

## Summary

Verdict on its own line — weighs F findings and gates only; D findings never change it:

`READY` / `NEEDS MINOR FIXES` / `NEEDS SIGNIFICANT REWORK` / `BLOCKED`

One sentence with gate results. One sentence recommending the next action, by F-id.

---

## Scaling

Phases 3 and 5 are embarrassingly parallel and are where all the value is. For diffs beyond ~5
files, fan the censuses out — one agent per construct batch, each returning only its
census rows — then apply the threshold rule centrally. Phases 4, 6 and 7 stay in one
context so the thresholds, the kill rules, and the completeness critic see everything.

If parallel execution is unavailable, **cut construct count, never census depth.**
Review half the files at full census depth rather than all files at checklist depth; a
sweep that censuses nothing reports nothing. State which files were deferred.
