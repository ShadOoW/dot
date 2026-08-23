### SYSTEM INSTRUCTION: SPEC-DRIVEN REFACTOR PLANNING

You are decomposing an architectural proposal into phase specifications that will be
executed by **independent fresh-session agents, one phase per session, several phases
concurrently**. Each spec is the agent's entire context. Its quality is measured by one
thing: how little the executing agent must rediscover.

A phase spec that makes the agent re-explore the repository has failed at its only job.

---

### INPUT REFACTOR PROPOSAL

[INSERT PROPOSAL / ARCHITECTURAL TEXT HERE]

---

### PRE-GENERATION OBLIGATIONS

Do these before writing any file. They are not optional and they are the difference
between a plan and a wish.

1. **Verify every path you are about to write.** Any `Files to Modify` or
   `Files to Delete` entry that does not exist sends the executing agent hunting.
   Confirm existence; confirm the symbol you name is actually in the file.
2. **Verify every risky external claim by execution, not by reading.** If the plan
   depends on a library API, a runtime behaviour, or a tool's output shape, run it
   and paste the observed result into the spec. Mark anything unexecuted `[INFERENCE]`.
3. **Build a file-ownership map.** For every file the plan touches, record which phases
   touch it. Two phases touching one file cannot run concurrently. This map is what
   makes parallel dispatch safe and it goes in the index.
4. **Resolve the wave structure.** Group phases into waves; a wave is a set of phases
   with no file overlap and no unmet dependency. State it explicitly — a dispatcher
   should not have to infer concurrency from a dependency list.

---

### REQUIREMENTS FOR PLAN GENERATION

1. **Directory Structure**
   - `.plans/` in the repository root.
   - `.plans/PLAN.md` — the index and the single status ledger.
   - `.plans/phase-XX-[brief-name].md` — one per phase, zero-padded, ordered.

2. **Master Index (`.plans/PLAN.md`)** must contain, in order:
   - **Executive summary** — what the refactor achieves, in under 200 words.
   - **House rules digest** — the repo conventions every executing agent must obey,
     stated once here rather than repeated in every phase. Include the exact gate
     command, the commit policy, and any skill/context file that must be loaded.
   - **Status ledger** — the checklist. `[ ] pending` / `[~] in progress` / `[x] done` /
     `[!] blocked`. **This is the only place status lives.** Phase files must not carry
     a status field; two copies of one fact drift.
   - **Wave table** — wave number, phases in it, and the assertion that they share no
     files.
   - **File-ownership map** — path → phases that touch it. Concurrency is read from here.
   - **Global invariants** — rules no phase may violate, each with the file that
     enforces it if one exists.
   - **Blocking external decisions** — unresolved questions that gate specific phases,
     naming the phase and the decision.

3. **Phase Files (`.plans/phase-XX-[brief-name].md`)** — exact structure:

   ```
   # Phase XX: [Brief Name]

   **Dependencies:** [None | Phase YY, Phase ZZ]
   **Parallel-safe with:** [phase list | nothing in this wave]
   **Status:** tracked in .plans/PLAN.md — do not add a status field here.

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

4. **Hand-off protocol** — state once in `PLAN.md`, not in every phase:
   - Gates green → set this phase to `[x]` in the ledger, commit code and ledger together.
   - Gates red → leave `[~]`, append to Findings, stop.
   - Never delete or restructure `.plans/` files.
   - Never edit a phase file other than your own, except appending to another's Findings
     when you have information it needs.

5. **Generation constraints**
   - **Every phase ends green.** The tree passes its gate at every phase boundary.
   - **No hidden context.** Never "as discussed above". Paths, symbols, signatures,
     literal.
   - **No orphans.** A deletion lands in the phase that replaces its callers.
   - **No scaffolds.** A phase does not deliver a stub for a later phase to fill. If
     work cannot be completed, it is not a phase yet.
   - **Right-size phases.** One reviewable change with one acceptance criterion. If the
     definition of done needs "and", consider splitting. If a phase is large but
     genuinely atomic (a mechanical migration of N call sites), keep it whole and make N
     explicit.
   - **Prefer parallel width over depth.** A dependency edge is a serialisation cost;
     only assert one where the later phase strictly cannot proceed without the earlier.

---

### ACTIONS TO EXECUTE NOW

Complete the pre-generation obligations, then write `.plans/PLAN.md` and every
`.plans/phase-XX-*.md` to the filesystem. Report the created files, the wave structure,
and any claim you could not verify.
