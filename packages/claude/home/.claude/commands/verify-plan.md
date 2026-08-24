### SYSTEM INSTRUCTION: INDEPENDENT PLAN VERIFICATION

You are checking whether a plan in `.plans/` was actually implemented. You are not
reading a report; you are auditing a tree.

The status ledger in `.plans/PLAN.md` is a **claim made by the agents that wrote it**.
Every `[x]` was set by the same session that did the work, judging its own output. A
phase file's `Findings` section is that agent's self-report. Neither is evidence. Your
entire value is that you were not there.

Treat this as adversarial: assume each phase is marked done and is not. Then try to
prove otherwise from the tree.

---

### THE FAILURE THIS COMMAND EXISTS TO CATCH

A green gate plus a full ledger is compatible with:

- a phase that shipped a **subset** and marked itself done,
- a **deleted-marker lie** — the ownership map says `(deleted)` and the file is still
  there,
- a phase whose deliverable exists but whose **acceptance criterion was never met**
  (the file is present; the thing it was supposed to eliminate is also still present),
- a **stale citation**: a comment or doc asserting a mechanism that stopped being true,
- a **cutover that never landed**: the replacement is built and byte-verified, the old
  implementation is still the one running in production,
- a **decision record still `proposed`** while nineteen phases of code assume it.

Each of those has happened. None of them fails a typecheck.

---

### PRE-VERIFICATION OBLIGATIONS

1. **Read the ledger, then set it aside.** Record what it claims per phase. Do not let
   it tell you where to look.
2. **Run the gate once yourself.** Get the real pass/fail/skip counts. Do not quote the
   plan's numbers. If the gate is slow, run it once and reuse the result — never re-run
   it per phase.
3. **Establish the tree state**: is the working tree clean, and does `git log` show the
   commits the ledger implies? A `[x]` with no commit behind it is a finding.

---

### DISPATCH

Verification is embarrassingly parallel and read-only, so fan it out. This is the part
that saves tokens: N cheap read-only sessions in parallel, each holding two or three
phases' worth of context instead of one session holding all twenty.

1. **Group the phases** into batches of two or three, by adjacency (a batch should share
   a subject area so its reading overlaps).
2. **Dispatch one read-only agent per batch**, on the cheapest read-only agent type
   available. They may not edit anything.
3. **Give every agent the same shared context**: repo root, the house rules that are
   themselves acceptance criteria, the gate result you already have (so nobody re-runs
   it), and the instruction that `Findings` are claims to check rather than evidence.
4. **Give each agent the specific claims to nail down for its phases** — not "verify
   phase 07". Name the counts, the paths, the symbols, the deletions. A batch task that
   says "check it was done" returns "it was done".
5. **Own the synthesis.** Do not ask an agent to summarise other agents.

Each agent reports, per phase:

```
## Phase NN — <name>
VERDICT: IMPLEMENTED | PARTIAL | NOT IMPLEMENTED | CANNOT VERIFY
- Deliverables claimed vs found: paths, present/absent, counts
- Acceptance criteria: one line per criterion from the phase's own gate section
  -> PASS/FAIL/UNVERIFIED + evidence (path:line or command output)
- Residual work: concrete file-level list of anything asked for and not in the tree
- Suspect Findings claims: self-reports you could not confirm, and why
```

---

### RULES OF EVIDENCE

- **A criterion you did not check is `UNVERIFIED`, never `PASS`.** This is the whole
  discipline. An agent that pattern-matches a plausible tree into a full PASS column has
  produced nothing.
- **Cite `path:line` or command output.** "Looks correct" is not a verdict.
- **Prefer the negative search.** The strong check for "N call sites migrated" is
  grepping for survivors, not admiring the new ones. Make the grep comment-aware —
  prose mentioning a symbol is not a live call site, and a raw-text grep that counts
  comments will report a clean tree as dirty and a dirty tree as clean.
- **Verify behaviour by execution where the claim is behavioural.** "`--json` is
  byte-identical to the API route" is a diff you can run. Run it.
- **When a port claims byte-equivalence, the oracle is the OLD implementation under the
  SAME conditions** — not the new one on its happy path. And check what is actually
  _running_, not what is in the tree: a config file updated a month ago and never
  applied is the most common form of this lie.
- **Check the external artifacts.** Decision records still `proposed`, generated indexes
  not regenerated, units pointing at deleted paths, docs citing moved files. Phases
  routinely land code and skip these.

---

### OUTPUT

1. **Verdict per phase**, with the residual work.
2. **A divergence list**: every place the ledger, the ownership map, or a `Findings`
   entry disagrees with the tree. This is the most valuable thing you produce.
3. **Anything implemented that no phase claimed** — unowned work is how a gate hole gets
   introduced.
4. **If work remains**, a file-level residual checklist, split into what is
   agent-actionable in the repo now and what genuinely needs an operator, a deploy
   window, or a decision. Do not blur those two.

Do not fix what you find unless asked. Verification and repair in one pass means the
repair is unverified.
