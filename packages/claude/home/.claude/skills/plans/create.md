# Creating a plan

The operator says `create a plan for …` or `plan …`; what follows is the input: the system,
proposal or body of work to be planned. You decompose it into an ordered ladder of steps in a new
folder `.plans/<plan>/` (layout and memory: `SKILL.md`, beside this file), give every step a depth,
and write the plan's `PLAN.md` and one thin file per step. You design no step here: each is designed
later in its own session (`design.md`), with the operator in the room when its depth is consult.

---

## Pre-generation obligations

Do these before writing any file. They are the difference between a plan and a wish.

1. **Inventory the primitives.** List every distinct mechanism the finished system rests on. One
   step per primitive is the starting point; merge only when two are genuinely inseparable, and say
   so in the step.
2. **Order by dependency of understanding, not by dependency of code.** A primitive that is only
   comprehensible once another is known comes second, even when the build order would permit
   either. Where the two orders disagree, follow comprehension and record that you did.
3. **Find what the house already does.** Every primitive the tree already uses somewhere is a
   comparison the design gets for free. Cite the existing use — an exemplar in the repo beats an
   invented example every time.
4. **Verify every path you are about to write.** Any path a step names that does not exist sends
   the session that runs it hunting. Confirm existence; confirm the symbol you name is actually in
   the file.
5. **Verify every risky external claim by execution, not by reading.** If the plan depends on a
   library API, a runtime behaviour, or a tool's output shape, run it and paste the observed result
   into the step. Mark anything unexecuted `[INFERENCE]`.
6. **Propose a depth for every step**, in the ladder table; the operator corrects the table once.
   Propose **consult** when the step decides something the operator will reason about later and has
   no industry-standard answer: a mechanism of his own system, a data model, a naming scheme,
   behaviour a user sees. Propose **inform** when a standard way exists (systemd wiring, a Nix
   module, a migration, a credential rotation) or the work is mechanical. What older plans call a
   chore is an inform step.
7. **Assign a drill to every step** (below). Decide it now, at plan time, so it is never a choice
   made when tired.

---

## Drills

A drill tests the restore path, not the operator. An annoying drill is a finding — it means
recovery is genuinely hard, discovered for the price of minutes instead of during an outage. Assign
the smallest tier that can fail. A step with no durable state writes `none — <why>` on its Drill
line.

- **Tier 2 — delete and recover.** Any step that creates durable state or a credential. Destroy the
  state, restart, and assert something **countable**: the cursor resumed at the right point,
  nothing was reprocessed, the count matches. A drill with no number always passes and therefore
  tests nothing.
- **Tier 3 — destroy the enclosure.** Once per phase, never per step. Delete the container or host,
  rebuild from the declaration, prove what should have survived did.

A drill performed manually twice becomes a script the third time, or it stops happening.

---

## What to write

1. **`.plans/<plan>/`** in the repository root: one folder for this plan, a short lowercase name
   the operator agrees to. Never add steps to another plan's folder.
2. **`.plans/<plan>/PLAN.md`**, with the `plans` skill's sections in its order (*PLAN.md, in
   order*). Its first line is `# <plan>`, or `# <plan> — a plan in waves` (below). House rules name
   the gate command, the commit subject, and any skill or context file that must be loaded; the
   repository's own rules are pointed to, never copied.
3. **`.plans/<plan>/NN-<name>.md`**, one per step, zero-padded, ordered. **Step files are thin at
   plan time**: you write what the step builds and how it will be judged; its Research, Naming and
   Design sections stay empty for the design session. Do not design the steps here; you would be
   guessing at decisions that belong to that session. Exactly this shape:

   ```
   # Step NN: <name>

   **Depth:** consult | inform
   **Assumes:** <steps this builds on, by name, or None>
   **Drill:** none — <why no durable state> | tier 2 — <what is destroyed, what count is asserted> | tier 3 — <the enclosure rebuilt>
   **Status:** tracked in the plan's PLAN.md — do not add a status field here.

   ## 1. Builds
   What is true for the operator after this step, in one or two plain sentences.

   ## 2. Leaves out
   What is deliberately not done here, and which step owns each.

   ## 3. Why here
   What it would be incomprehensible without, and what cannot proceed until it lands.

   ## 4. Reading list
   Each source with its size in lines and why it is on the list.

   ## 5. Prior art in this tree
   Where the house already does this, with path:line.

   ## 6. Research — filled by the design session
   The options and why the rejected ones lose; the fact check's answers and the field survey's
   options with their sources; what the research changed.

   ## 7. Naming — filled by the design session
   Words introduced, each checked for collision.

   ## 8. Design — filled by the design session
   Opens with its **Build session** line. The entire input to the build: if a fresh session cannot
   build from it, it is not finished. Includes where any state lives and what restores it.

   ## 9. Definition of done
   Countable where possible.

   ## 10. Gates
   The exact commands and expected results.

   ## 11. Findings
   (Empty. Sessions append: surprises, design defects, corrections, the build record.)
   ```

---

## A plan in waves

When steps are independent and may run concurrently, executed by fresh-session agents, one phase
per agent, several at once (`waves.md`), the plan is a plan in waves. Its first line is
`# <plan> — a plan in waves`. Each phase file is that agent's entire context, and its quality is
measured by one thing: how little the executing agent must rediscover. A phase file that makes the
agent re-explore the repository has failed at its only job.

Two more pre-generation obligations:

1. **Build a file-ownership map.** For every file the plan touches, record which phases touch it.
   Two phases touching one file cannot run concurrently. This map is what makes parallel dispatch
   safe and it goes in `PLAN.md`.
2. **Resolve the wave structure.** Group phases into waves; a wave is a set of phases with no file
   overlap and no unmet dependency. State it explicitly — a dispatcher should not have to infer
   concurrency from a dependency list.

`PLAN.md` adds, after the ledger:

- **Wave table** — wave number, phases in it, and the assertion that they share no files.
- **File-ownership map** — path → phases that touch it. Concurrency is read from here.
- **Global invariants** — rules no phase may violate, each with the file that enforces it if one
  exists.
- **Blocking external decisions** — unresolved questions that gate specific phases, naming the
  phase and the decision. They are also Open items.

Each phase file, `.plans/<plan>/NN-<name>.md`, has exactly this structure:

```
# Phase XX: [Brief Name]

**Dependencies:** [None | Phase YY, Phase ZZ]
**Parallel-safe with:** [phase list | nothing in this wave]
**Status:** tracked in the plan's PLAN.md — do not add a status field here.

## 1. Objective
One sentence. What is true after this phase that is not true now.

## 2. Why this way
Two to five sentences of decision rationale, or a pointer to the decision record.
An agent that does not know why will optimise the wrong axis under pressure.

## 3. Bounded reading list
The files this phase requires, each with the specific lines or symbols that matter
and one line on why. This list should be sufficient. If the agent must read outside
it, that is a defect in this spec: record what was missing under Findings.

## 4. Pre-loaded evidence
Facts already established, so the agent does not re-derive them: verified path:line
citations, observed command output, exact API signatures, counts. Mark unverified
items [INFERENCE].

## 5. File scope
- Modify: exact/path.ts — what changes
- Create: exact/path.ts — what it contains
- Delete: exact/path.ts — what replaces it
Files not listed here are out of scope. Touching them collides with a sibling agent.

## 6. Out of scope
Adjacent problems this phase must leave alone, and which phase owns each. This
section prevents the most expensive failure mode: a helpful agent fixing the next
phase's work and colliding with the agent doing it.

## 7. Contracts
Exact signatures, types, schemas, and exported names to implement or consume.
Code, not description. Downstream phases depend on these being literal.

## 8. Steps
Ordered, concrete, each independently checkable.

## 9. Invariants
Domain rules that must survive this phase unchanged, and the anti-patterns that
would break them. Name the incident behind each one where there is one — a rule
with a scar attached survives contact with a deadline.

## 10. Definition of done
Countable where possible: "zero occurrences of X", "N call sites migrated",
"gate fails on fixture F and passes on the tree". Not "the code is cleaner".

## 11. Gates
The exact commands to run and the expected result. Include any new gate this phase
installs, plus the failing fixture that proves the gate works.

## 12. If blocked
Do not partially land. Do not widen scope. Do not edit another phase's files.
Append what you found to Findings below, leave the tree green, and report the
blocker with the evidence that established it.

## 13. Findings
(Empty at authoring time. The executing agent appends: surprises, spec defects,
corrections for downstream phases, anything the next agent would want.)
```

Phase-specific constraints:

- **No hidden context.** Never "as discussed above". Paths, symbols, signatures, literal.
- **No orphans.** A deletion lands in the phase that replaces its callers.
- **Right-size phases.** One reviewable change with one acceptance criterion. If the definition of
  done needs "and", consider splitting. If a phase is large but genuinely atomic (a mechanical
  migration of N call sites), keep it whole and make N explicit.
- **Prefer parallel width over depth.** A dependency edge is a serialisation cost; only assert one
  where the later phase strictly cannot proceed without the earlier.

---

## Hand-off protocol

State it once in `PLAN.md`, not in every step:

- Gates green → set this step to `[x]` in the ledger, commit code and ledger together.
- Gates red → leave `[~]`, append to Findings, stop.
- Every boundary: rewrite Current state, add or close Open items, one History line.
- Never delete or restructure the plan's files; closing is the operator's call (the `plans` skill,
  `close.md`).
- Never edit a step file other than your own, except appending to another's Findings when you have
  information it needs.

---

## Generation constraints

- **Every step ends green.** The tree passes its gate at every step boundary.
- **No scaffolds.** A step does not leave a stub for a later step to fill. If work cannot be
  completed, it is not a step yet.
- **Right-size for one sitting.** A step that cannot be designed, built and drilled in one evening
  is too big regardless of how atomic it looks.

---

## Report

At the end: the ladder with each step's proposed depth, every place understanding order and build
order disagreed, every unverified claim; then `## Needs you` and `## Next` (`design <plan> 01` in
a new session on Opus: `/new`, `/so5`, `design <plan> 01`).
