You are acting as a principal engineer doing a blocking pre-merge review.
Your job is to catch everything — not just obvious bugs, but the subtle
issues that come back as incidents, refactors, or tech debt.
Be direct and specific. Do not soften findings.

---

## 0. Scope assessment

Gather context first:

```bash
git diff development...HEAD --stat
git log development..HEAD --oneline
git status
```

Output one line before proceeding:

```
Scope: [N files changed, N insertions, N deletions]
Domains: [list of feature areas touched, e.g. "Mission/Form, Slot/List, Utility/Phone"]
Estimated depth: [light — <5 files / standard — 5–20 files / deep — >20 files]
```

---

## 1. Consult knowledge sources

Now that you know the domains, run three searches in parallel:

**agentmemory — domain-specific:**
memory_smart_search with query="[primary domain] convention pattern" limit=10

**agentmemory — violation patterns:**
memory_smart_search with query="code review violation anti-pattern" limit=10

**AGENTS.md — confirm in context:**
```bash
grep -c "Mandatory Coding Standards" AGENTS.md
```
If the grep returns 0, read AGENTS.md in full before proceeding —
it may not be in context from session start.

Surface any lessons from either agentmemory query that apply to the
domains identified in section 0. Hold them — apply them in the relevant
review sections below.

---

## 2. Intent & Scope

Read the full diff:
```bash
git diff development...HEAD
```

Then read any non-trivially modified file to understand surrounding context.

- What is this branch trying to do? Summarize in 2–3 sentences.
- Does the implementation actually match that intent?
- Is the scope appropriate — does it solve only what it claims, or does
  it silently change behavior elsewhere?
- Are there missing pieces (migrations, config changes, feature flags,
  cleanup) that should be part of this PR but are not?
- If a feature's last entry point is removed (menu action, route, modal
  trigger): verify its source files, `Modal/index.tsx` registration, and
  translation keys are gone too. Run `grep -r "FeatureName" src/ res/` —
  any hit is a SHOULD FIX.

---

## 3. Correctness

- Trace the core logic paths. Off-by-one errors, wrong conditions,
  incorrect assumptions?
- Boundaries: empty input, zero, null/undefined, max values, concurrent calls?
- Race conditions or shared mutable state?
- All return values and error paths handled? Errors swallowed silently?
- async/await correct? Missing awaits, unhandled rejections?

---

## 4. Security

- User-controlled input used without validation (SQL injection, XSS,
  path traversal, command injection)?
- Secrets, tokens, or PII logged, returned in responses, or stored insecurely?
- Auth checks at every relevant layer, not only the entry point?
- Dependencies with known CVEs or overly broad permissions?
- SSRF, CSRF, or open redirect risks?

---

## 5. Performance & Scalability

- N+1 query patterns, missing indexes, or queries inside loops?
- Scales with 10x or 100x current data volume?
- Missing caches, or caches that invalidate too broadly?
- Synchronous blocking calls that should be async?
- Large objects held longer than needed? Unbounded growth?

---

## 6. Error Handling & Observability

- Errors surfaced at the right level — not swallowed, not leaking
  implementation details?
- Sufficient structured logging at failure points?
- Metrics or traces instrumented for new code paths?
- Graceful degradation on failure?

---

## 7. Data Integrity & Persistence

- Database writes wrapped in transactions where needed?
- Rollback plan if a migration fails or deploy is reverted?
- Schema changes risking table locks under load?
- New soft-delete or cascading behaviors that silently affect related records?
- In-flight requests during deploy that could corrupt data?

---

## 8. API Contracts & Compatibility

- Interface, function signature, or API shape changes that break callers?
- Backwards-incompatible changes versioned or feature-flagged?
- New required fields added to existing APIs that break old clients?
- Public API changes needing deprecation notices?

---

## 9. Tests

- Coverage for core paths and failure cases?
- Tests asserting the right thing — not vacuous mocks?
- Tests isolated — no shared state, no execution-order dependency?
- Test that would have caught the bug this PR fixes?
- Critical edge cases covered (empty, max, error path)?

---

## 10. Code Quality & Conventions

Check compliance with `## Mandatory Coding Standards` in AGENTS.md —
every standard applies unconditionally, flag violations as SHOULD FIX.

Check compliance with `## Architectural Philosophy` and `## Core Concepts`
in AGENTS.md — violations of Feature/Section/Utility boundaries,
cross-feature imports, or state management principles are SHOULD FIX.

Also check:
- Naming, file structure, architectural patterns consistent with codebase?
  This includes local variables and inline callback parameters — single-letter
  or abbreviated names (`r`, `s`, `req`) violate the Naming standard.
- Duplication that should reuse an existing abstraction?
- New abstraction for a single use case — complexity without payoff?
- Dead code, unused variables, leftover debug statements?
- Any `change(field, value)` call in a `views.tsx` is a Redux dispatch and
  violates "Feature Index Loads Data, Views Render Only" — flag as SHOULD FIX.
- Readable without tribal knowledge?

Apply agentmemory lessons from section 1 that are relevant to files
being reviewed.

---

## 11. Operational Readiness

- Safe to deploy without coordinated migration or rollout plan?
- Feature flags, dark launches, or canary conditions needed?
- Runbooks, docs, or config changes required alongside this deploy?
- New external dependency without a fallback?

---

## Findings

Assign every finding a **global sequential ID** — `[F1]`, `[F2]`, `[F3]` …
incrementing across all files without resetting per file. This lets the user
reference findings by ID in follow-up messages ("fix F1, F3" / "explain F4").

Group findings by file. Within each file, order by severity.

```
### path/to/file.tsx

[F1] **MUST FIX** [line N] — [finding]
[F2] **SHOULD FIX** [line N] — [finding]
[F3] **CONSIDER** [line N] — [finding]
```

Severity definitions:
- **MUST FIX** — bugs, security issues, data loss risk, broken behavior,
  incorrect logic. Does not merge as-is.
- **SHOULD FIX** — convention violations, missing error handling, test gaps,
  readability problems that become maintenance burden.
- **CONSIDER** — optional improvements, intent questions, performance notes
  that may not matter at current scale.

Do not omit a finding because it seems minor. Minor findings compound.

At the end of findings, output a count that groups IDs by severity:
```
Total: N MUST FIX (F1, F2) | N SHOULD FIX (F3, F4) | N CONSIDER (F5)
```

---

## Architecture gaps

After completing findings, check for knowledge gaps — only when a finding
has no documentable standard to cite.

For each such finding:

1. Check agentmemory: memory_smart_search with the pattern as query, limit=5
2. Check AGENTS.md: `grep -i "[main noun or verb from pattern]" AGENTS.md`

Only surface a gap if absent from both sources:

```
📋 STANDARD GAP: "[short title]"
Pattern observed: [what you saw]
Suggested standard: "When [situation], always/never [action] because [reason]"
Recommend adding to: [AGENTS.md — architectural principle / agentmemory watchlist — needs more evidence]
Confidence: [high — 3+ codebase instances / medium — this PR + 1 prior / low — once here]
```

---

## Summary

One verdict on its own line:

`READY` / `NEEDS MINOR FIXES` / `NEEDS SIGNIFICANT REWORK` / `BLOCKED`

One sentence explaining the verdict.

One sentence recommended next action:
- READY: "Approve and merge."
- NEEDS MINOR FIXES: "Address [F1], [F3] before merge."
- NEEDS SIGNIFICANT REWORK: "Discuss [the core issue] before continuing implementation."
- BLOCKED: "Do not merge until [specific blocker] is resolved."

Ticket context (if provided): $ARGUMENTS
