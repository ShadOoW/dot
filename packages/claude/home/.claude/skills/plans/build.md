# Building one designed step

The operator says `build <plan> NN`, `build the next step`, or `next step` when the ledger's first
open step is `[>]`. You build that one step of the plan in `.plans/<plan>/` from its design, in a
fresh session (layout, memory and replies: `SKILL.md`, beside this file). The design was written by
another session that you cannot see, with the operator when the step's depth is consult. Your
context is the step file and the repository.

**Find the design by its heading text**, `Design`, whatever its number: old step files have it at
§9, new ones at §8.

---

## Why this is a separate session

The separation is not hygiene, it is the test. A design is supposed to be complete enough for
someone who was not in the conversation to build from. **If you cannot build from the Design
section, the design is vague — and that vagueness passed a review without being noticed, which is
the exact failure the ladder exists to prevent.**

So: do not reconstruct the missing reasoning, do not infer what they probably meant, and do not
improve the design. Report the gap. A step that halts on an underspecified design has produced the
most valuable finding available at that moment.

---

## Pre-build obligations

1. **Read the whole step file**, then the plan's `PLAN.md`: Current state, House rules (and the
   repository rules it points to), Open items and the Established list. The Established list tells
   you which primitives are already in place and may be used without ceremony.
2. **Confirm the step is `[>]`** in the ledger. `[ ]` or `[~]` means it has not been designed —
   stop and say so; do not design it yourself. `[x]` means it is closed: say so and stop (the lesson
   about a session launched on a closed step).
3. **Check the Design section is buildable before you start.** Every path, name, and contract it
   names must exist or be created by this step. Missing pieces are reported, not invented.
   The Design section opens with a **Build session** line naming the model meant to build it.
   Compare it with the model you are running on (your system context names it). A mismatch is not
   a blocker, since the operator launched this session: say it in the first line of your first
   reply and in the build record, then continue. A design written before the line existed has
   none; say so the same way.
4. **Check what was handed forward.** If the plan's Open items or the previous step's Findings name
   a check for the next session, run it first. A stale unit is a Finding of this run; it blocks
   nothing this step did not cause.
5. **Run the gate once, now.** This is your baseline; without it you cannot attribute a later
   failure to this step. Do anything the design lists for the operator first now, too, before the
   build, so you are not waiting for it halfway through.

---

## Build

Implement exactly what the Design section says. Nothing adjacent, nothing anticipatory.

- **No scope widening.** Adjacent breakage you notice is a Findings entry, not a fix — except a
  one-line fix the gate covers, which is made and recorded.
- **Decisions inside the design's intent are made, not asked**, and recorded in Findings as
  `Decided: <what> — reverse by <how>`.
- **No scaffolds for later steps.** The next step is somebody's lesson; leaving them a stub steals
  it.
- **Clean cutover.** House rule: no shims, no aliases, no deprecated paths. Migrate every caller in
  this step or report that you cannot.
- **Where the design and the tree disagree, the tree wins and the design is a finding.** Specs are
  written before the tree moves.

---

## Verify

1. **The gate**, on the integrated tree, green.
2. **The definition of done, checked yourself.** Countable criteria are countable — count them.
   Spot-check the negative: grep for what was supposed to be eliminated.
3. **The drill, as the step's Drill line declares.** `none` means none. An old step file whose
   Drill line says tier 1 gets its two sentences in Findings: what is lost, what brings it back.
   - _Tier 2 — delete and recover:_ actually destroy the state, restart, and assert the
     **countable** claim the step names. A drill that cannot fail has tested nothing — if recovery
     would have passed without the destruction, say so and fix the drill.
   - _Tier 3 — destroy the enclosure:_ rebuild from the declaration and prove what should have
     survived did.

   Record how long the drill took. A drill run manually twice must become a script on the third
   occurrence; note when a step crosses that line. An annoying drill is a finding about the restore
   path, not a complaint — write it down as one.

   Never block waiting for a timer. Unless this step adds or changes a timer, its unit or its
   status unit, run every gate on a start by hand (`systemctl start <unit>.service`). If the step
   does need the timer's own run, land on the gates that ran and put the check in the plan's Open
   items for the next session (the repository's rules, which the plan's House rules point to).
   Start the VM test and its mutations together.

---

## Record — this is not optional

The code is the byproduct. The record is the point.

1. **Append to the step's Findings:** what surprised you, every place the design was wrong or
   thin, every `Decided:` line, corrections later steps need, and the drill result with its number
   and its duration.
2. **End the step's Findings with a build record:** what it landed, the single most surprising
   thing, whether the design was buildable as written, and the model and effort this session ran
   on. This is the honest record of whether the approach is working, and the only record of
   whether the cheaper model held; a step that landed code and recorded nothing did not happen.
3. **Update `PLAN.md`:** one line in Established for the primitive this step put in place; Open
   items added or closed; Current state rewritten; one History line.
4. **Flip the ledger** to `[x]` and commit code, step file and ledger together. Leave `[~]` or
   `[!]` with the blocker and its evidence if anything is unfinished.

Never mark a step `[x]` because the work felt done. The ledger is what the next session trusts; an
unverified claim there is how a plan starts lying.

---

## If blocked

Do not partially land. Do not widen scope. Do not design around the gap. Append to Findings, leave
the tree green, set `[!]`, and report the blocker with the evidence that established it —
including, when the cause is an underspecified design, exactly which sentence of the Design section
could not be acted on. Name which of the three causes in the `plans` skill's retry table it was
(the design, the model's capability, or the effort), with the evidence for that one rather than the
others; the retry follows from it. When it was the model's capability, rewrite the Build session
line to `Opus 5.5 — escalated: <Finding number>`, the one edit to the Design section a build may
make, so the retry is launched on the model it needs.

---

## Reply

Written after the commit, or after the blocker has been recorded.

- First line: what is now true, in the operator's terms.
- "Changed from the design" only when he would notice the difference in use.
- Gate results in one line.
- `## Needs you` per the `plans` skill.
- `## Next`, from the ledger in `.plans/<plan>/PLAN.md` read again now, in the in-window form the
  `plans` skill gives:
  - This step is `[x]`: the first step after it that is not `[x]` — `[>]` → `/new`, the switch for
    its Build session model (read from that step's Design section; Sonnet 5.5 if it has no Build
    session line, saying the line was missing), `build <plan> MM`; `[ ]` or `[~]` → `/new`, `/so5`,
    `design <plan> MM`. None left → the plan has met its Done when, and the operator may say
    "review <plan>".
  - This step is `[!]` or `[~]`: what unblocks it, and the retry phrase the retry table names for
    the cause: `design <plan> NN` again; `build <plan> NN` on Opus; `build <plan> NN` one effort
    level up. A blocker outside the design is `build <plan> NN` on the same model.
  - Why it has to be a new session: every step starts from its written record, never from this
    conversation.

Nothing comes after `## Next`.
