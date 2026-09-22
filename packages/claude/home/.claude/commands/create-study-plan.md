### SYSTEM INSTRUCTION: BUILD A STUDY LADDER

You are decomposing a system the operator intends to **understand**, not merely to
own, into an ordered ladder of steps. Each step teaches exactly one primitive and ends
with something built. The operator will not write the code; the operator must be able
to explain every piece of it afterwards.

This is the sibling of `/create-plan` and differs from it in one axis, from which
everything else follows: **`/create-plan` optimises for the executing agent
rediscovering nothing. This optimises for the operator being able to explain the
result with the files closed.**

---

### INPUT

[INSERT THE SYSTEM, PROPOSAL, OR DOMAIN TO BE LEARNED]

---

### WHAT MAKES THIS DIFFERENT, AND WHY EACH DIFFERENCE EXISTS

1. **Serial, not parallel.** `/create-plan` produces waves because independent phases
   can run concurrently. Here concurrency is the defect: a person cannot learn four
   primitives at once, and two steps landing together means neither was understood.
   There is no wave table and no file-ownership map. There is a ladder.
2. **The unit is one explainable concept, not one reviewable change.** A step that
   introduces two mechanisms is mis-sized even when the diff is small. The test is not
   "can this be reviewed" but "can this be explained".
3. **Comparison is a required section.** A step that presents only the chosen design
   teaches a recipe. The operator must see the alternatives and why each loses, or
   they cannot evaluate the next decision without asking.
4. **Naming happens in the spec, before the code.** Naming is planning. A word chosen
   during implementation is a word nobody reviewed.
5. **The step files are thin at plan time.** You write the syllabus entry — what this
   step teaches and how it will be judged. The *design* is produced later by `/study`,
   with the operator in the room. Do not design the steps here; you will be guessing at
   decisions that are the point of the exercise.

---

### PRE-GENERATION OBLIGATIONS

Do these before writing any file.

1. **Inventory the primitives.** List every distinct mechanism the finished system
   rests on. One step per primitive is the starting point; merge only when two are
   genuinely inseparable, and say so in the step.
2. **Order by dependency of understanding, not by dependency of code.** A primitive
   that is only comprehensible once another is known comes second, even when the build
   order would permit either. Where the two orders disagree, follow comprehension and
   record that you did.
3. **Find what the house already does.** Every primitive the tree already uses
   somewhere is a comparison the operator gets for free. Cite the existing use — an
   exemplar in the repo beats an invented example every time.
4. **Separate chores from steps.** Work that must happen but teaches nothing (a
   migration, a credential rotation, a backup) is a **chore**: listed in the ladder,
   gated like a step, but carrying no teaching obligation and no comparison. Calling a
   chore a step wastes the operator's attention on something with nothing to learn.
5. **Assign a drill tier to every step** (see below). Decide it now, at plan time, so
   it is never a choice made when tired.

---

### DRILL TIERS

A drill tests the restore path, not the operator. An annoying drill is a finding — it
means recovery is genuinely hard, discovered for the price of minutes instead of during
an outage. Assign the smallest tier that can fail.

- **Tier 1 — paper.** Every step. Two sentences: what is lost if this vanishes, and
  what brings it back. No execution. For a step that teaches a pure mechanism, the
  honest answer is "nothing" — recording that is what proves the step introduced no
  state.
- **Tier 2 — delete and recover.** Any step that creates durable state or a credential.
  Destroy the state, restart, and assert something **countable**: the cursor resumed at
  the right point, nothing was reprocessed, the count matches. A drill with no number
  always passes and therefore tests nothing.
- **Tier 3 — destroy the enclosure.** Once per phase, never per step. Delete the
  container or host, rebuild from the declaration, prove what should have survived did.

A drill performed manually twice becomes a script the third time, or it stops happening.

---

### REQUIREMENTS FOR GENERATION

1. **Directory structure**
   - `.plans/` in the repository root.
   - `.plans/PLAN.md` — the ladder, the ledger, and the concept inventory.
   - `.plans/study-XX-[brief-name].md` — one per step, zero-padded, ordered.
   - `.plans/CHECKPOINTS.md` — created empty with its header. Append-only.

2. **`.plans/PLAN.md`** must contain, in order:
   - **What this is** — the system being learned and why, under 200 words.
   - **The contract** — the division of labour, stated once: the agent drafts and
     implements; the operator owns the *why*, answers the five questions before code,
     and must be able to explain each landed step with the files closed.
   - **House rules digest** — repo conventions every session must obey: the gate
     command, the commit policy, and any skill or context file that must be loaded.
   - **The ladder** — a table: step number, name, the one primitive it teaches, what it
     composes into, drill tier, and whether it is a step or a chore.
   - **Status ledger** — `[ ] pending` / `[~] in design` / `[>] designed, awaiting
     build` / `[x] done` / `[!] blocked`. **The only place status lives.** Step files
     carry no status field.
   - **Concept inventory** — the primitives established so far, appended as steps land.
     This is what lets a later step say "assumes 04, 07" instead of re-teaching.
   - **Global invariants** — rules no step may violate, each with the file that
     enforces it where one exists.
   - **Open questions** — decisions deliberately deferred, each with the gate that would
     settle it. A deferred decision with no gate is a decision being avoided.
   - **Kill criterion** — the condition under which this plan is wrong and must be
     re-cut. Default: two consecutive steps failing the explain-it-back gate means the
     steps are too large; stop and re-split rather than pushing through.

3. **`.plans/study-XX-[brief-name].md`** — thin at plan time, exactly this shape:

   ```
   # Step XX: [Brief Name]

   **Kind:** step | chore
   **Assumes:** [steps whose concepts this builds on, or None]
   **Drill:** tier N — [what specifically gets destroyed and what is asserted]
   **Status:** tracked in .plans/PLAN.md — do not add a status field here.

   ## 1. Teaches
   The ONE primitive. One sentence. A chore says "nothing — this is a chore" and why
   it must happen anyway.

   ## 2. Does not introduce
   Mechanisms deliberately absent, and which step owns each. This is the section that
   catches a step that smuggled in a second concept.

   ## 3. Why here
   Why this position in the ladder — what it would be incomprehensible without, and
   what cannot proceed until it lands.

   ## 4. Reading list — for the OPERATOR
   What to read to understand this, each with why. Real sources: man pages, vendored
   source, the tree's own exemplars. Not summaries, and never the model's memory.

   ## 5. Prior art in this tree
   Where the house already does this, with path:line. An existing exemplar is worth
   more than any explanation.

   ## 6. Comparison — filled during /study
   (Empty at plan time. The alternatives and why each loses.)

   ## 7. Naming — filled during /study
   (Empty at plan time. Words introduced, each checked for collision.)

   ## 8. The five answers — filled during /study, owned by the operator
   What breaks without it · who consumes it · where its state lives · how it is
   restored · what it costs to run.

   ## 9. Design — filled during /study
   (Empty at plan time. The confirmed design. This section is the entire input to
   /execute-study-step; if a fresh session cannot build from it, it is not finished.)

   ## 10. Definition of done
   Countable where possible. Not "it works".

   ## 11. Gates
   The exact commands and expected results.

   ## 12. Findings
   (Empty. The building session appends: surprises, spec defects, corrections.)
   ```

4. **Generation constraints**
   - **Every step ends green.** The tree passes its gate at every step boundary.
   - **No scaffolds.** A step does not leave a stub for a later step to fill.
   - **No step teaches two things.** If the "Teaches" line needs "and", split it.
   - **Chores are labelled.** Never disguise work as learning.
   - **Right-size for one sitting.** A step that cannot be taught, designed, built and
     drilled in one evening is too big regardless of how atomic it looks.

---

### ACTIONS TO EXECUTE NOW

Complete the pre-generation obligations, then write `.plans/PLAN.md`, every
`.plans/study-XX-*.md`, and an empty `.plans/CHECKPOINTS.md`. Report the ladder, the
chores you separated out, every place comprehension order and build order disagreed,
and any claim you could not verify.
