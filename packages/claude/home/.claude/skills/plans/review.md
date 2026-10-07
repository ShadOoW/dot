# Reviewing a plan

Two halves, in this order: an adversarial check that the plan did what its ledger says, then a
retrospective of how it went. The review writes nothing into the code; it changes only the
plan's `PLAN.md` (Open items, Current state, one History line) and reports.

## 1. Verify: the ledger is a claim, not evidence

Every `[x]` was set by the session that did the work, judging its own output, and every Findings
entry is that session's self-report. Assume each step is marked done and is not, then try to
prove otherwise from the tree.

A green gate and a full ledger are compatible with all of these, and each has happened:

- a step that shipped a **subset** and marked itself done;
- a file the plan says was deleted that is still there;
- a deliverable present whose **acceptance criterion was never met** (the file exists; the thing
  it was meant to eliminate also still exists);
- a **stale citation**: a comment or doc asserting a mechanism that stopped being true;
- a **cutover that never landed**: the replacement built and tested, the old one still running;
- a decision record still `proposed` while the code assumes it.

**Before dispatching:**

1. Read the ledger, record what it claims per step, and set it aside.
2. Run the repository's gate once yourself and keep the real counts. Never quote the plan's.
3. Check the tree: clean or not, and a commit behind every `[x]`
   (`git log --grep '^<plan> NN:'`). An `[x]` with no commit is a finding.

**Dispatch** read-only agents, two or three steps each, grouped so their reading overlaps. Give
every agent the gate result (nobody re-runs it), the repository's rules that are acceptance
criteria, and the specific claims to nail down for its steps: the counts, paths, symbols and
deletions, never "verify step 07". Own the synthesis yourself.

Each agent reports, per step:

```
## <plan> NN — <name>
VERDICT: IMPLEMENTED | PARTIAL | NOT IMPLEMENTED | CANNOT VERIFY
- Deliverables claimed vs found: paths, present or absent, counts
- Acceptance criteria, one line each from the step's own gates: PASS / FAIL / UNVERIFIED + evidence
- Residual work: a file-level list of anything asked for and not in the tree
- Suspect Findings: self-reports that could not be confirmed, and why
```

**Rules of evidence:**

- A criterion nobody checked is `UNVERIFIED`, never `PASS`.
- Cite a path and symbol, or command output. "Looks correct" is not a verdict.
- Prefer the negative search: grep for survivors of what was meant to go, comment-aware, since
  prose that mentions a symbol is not a live use.
- Verify behaviour by running it where the claim is behavioural, and check what is **running**,
  not only what is in the tree: a config changed and never applied is the commonest form of
  this lie.
- Check the artifacts outside the code: decision records, generated files, units pointing at
  deleted paths, docs citing moved files.

## 2. Retrospective: measure the plan, not the mood

Answer each from the record, with a number where one exists:

- **Delivered:** steps done against "Done when"; what is true now that was not.
- **Scope:** steps at creation, steps now, and each step added outside "Done when" (there should
  be none; each one is a finding about how the plan was run).
- **Builds that stopped,** grouped by cause: a design the tree contradicted, a gate that could
  not fail, a precondition outside the plan, a live-system fact learned too late.
- **Lessons hit more than once:** the same surprise in two or more steps' Findings means the
  lesson never reached a check, a tool or a skill.
- **Open items carried:** items that sat in Open items across several sessions without moving.
- **The plan's own instruments:** if the plan has a kill criterion or an explain-back, did it
  ever produce a reading? An instrument that never ran is reported as such, not as a pass.
- **Writing against code:** lines of plan markdown against lines of code changed.
- **What worked,** with the evidence: the gate that caught a real defect, the drill that failed
  for a reason.

## 3. Output

1. The verdict per step, with residual work split into what an agent can do in the repository
   now and what needs the operator, a deploy window or a decision.
2. Every place the ledger, a Findings entry or the plan's text disagrees with the tree.
3. Work in the tree that no step claimed.
4. The retrospective, conclusion first.
5. In `PLAN.md`: residual work added to Open items, Current state rewritten, and one History line
   (`date · review · verdict in one clause`). Commit as `plan: <plan> — reviewed: …`.

Do not fix what the review finds unless the operator asks: a repair made in the same pass as
its verification is unverified.
