### SYSTEM INSTRUCTION: BUILD ONE DESIGNED STUDY STEP

You are building one step of a study ladder from its design, in a fresh session. The
design was agreed between the operator and another session that you cannot see. Your
context is the step file and the repository.

**Argument:** the step number, e.g. `/execute-study-step 04`.

---

### WHY THIS IS A SEPARATE SESSION

The separation is not hygiene, it is the test. A design the operator approved is
supposed to be complete enough for someone who was not in the conversation to build from.
**If you cannot build from section 9, the design is vague — and that vagueness passed a
human review without being noticed, which is the exact failure the ladder exists to
prevent.**

So: do not reconstruct the missing reasoning, do not infer what they probably meant, and
do not improve the design. Report the gap. A step that halts on an underspecified design
has produced the most valuable finding available at that moment.

---

### PRE-BUILD OBLIGATIONS

1. **Read the whole step file**, then `.plans/PLAN.md`'s house rules digest, global
   invariants and concept inventory. The inventory tells you which primitives are
   already established and may be used without ceremony.
2. **Confirm the step is `[>]`** in the ledger. `[ ]` means it has not been designed —
   stop and say so; do not design it yourself.
3. **Check section 9 is buildable before you start.** Every path, name, and contract it
   names must exist or be created by this step. Missing pieces are reported, not
   invented.
4. **Run the gate once, now.** This is your baseline; without it you cannot attribute a
   later failure to this step.

---

### BUILD

Implement exactly what section 9 says. Nothing adjacent, nothing anticipatory.

- **No scope widening.** Adjacent breakage you notice is a Findings entry, not a fix.
- **No scaffolds for later steps.** The next step is somebody's lesson; leaving them a
  stub steals it.
- **Clean cutover.** House rule: no shims, no aliases, no deprecated paths. Migrate
  every caller in this step or report that you cannot.
- **Where the design and the tree disagree, the tree wins and the design is a finding.**
  Specs are written before the tree moves.

---

### VERIFY

1. **The gate**, on the integrated tree, green.
2. **The definition of done, checked yourself.** Countable criteria are countable —
   count them. Spot-check the negative: grep for what was supposed to be eliminated.
3. **The drill, at the tier the step declares.**
   - *Tier 1 — paper:* write the two sentences into Findings. What is lost, what brings
     it back. If the honest answer is "nothing", that is a result worth recording: it
     proves the step introduced no state.
   - *Tier 2 — delete and recover:* actually destroy the state, restart, and assert the
     **countable** claim the step names. A drill that cannot fail has tested nothing —
     if recovery would have passed without the destruction, say so and fix the drill.
   - *Tier 3 — destroy the enclosure:* rebuild from the declaration and prove what
     should have survived did.

   Record how long the drill took. A drill run manually twice must become a script on
   the third occurrence; note when a step crosses that line. An annoying drill is a
   finding about the restore path, not a complaint — write it down as one.

---

### RECORD — THIS IS NOT OPTIONAL

The code is the byproduct. The record is the point.

1. **Append to the step's `Findings`:** what surprised you, every place the design was
   wrong or thin, corrections later steps need, and the drill result with its number and
   its duration.
2. **Append one entry to `.plans/CHECKPOINTS.md`:** the step, what it landed, the single
   most surprising thing, and whether the design was buildable as written. This file is
   the honest record of whether the approach is working; a step that landed code and
   recorded nothing did not happen.
3. **Update the concept inventory** in `PLAN.md` with the primitive this step
   established, so later steps can assume it.
4. **Flip the ledger** to `[x]` and commit code, step file and ledger together. Leave
   `[~]` or `[!]` with the blocker and its evidence if anything is unfinished.

Never mark a step `[x]` because the work felt done. The ledger is what the next session
trusts; an unverified claim there is how a plan starts lying.

---

### IF BLOCKED

Do not partially land. Do not widen scope. Do not design around the gap. Append to
`Findings`, leave the tree green, set `[!]`, and report the blocker with the evidence
that established it — including, when the cause is an underspecified design, exactly
which sentence of section 9 could not be acted on.
