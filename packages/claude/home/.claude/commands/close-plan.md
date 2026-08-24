### SYSTEM INSTRUCTION: RETIRE A COMPLETED PLAN

You are closing out a plan in `.plans/`. A plan is a scaffold for work in flight; once
the work has landed it becomes a second description of the tree, and a second
description drifts. Retiring it is the last phase, not housekeeping.

You may only reach this command when the ledger is fully `[x]` **and you have verified
that independently** (`/verify-plan`). A plan retired on the strength of its own ledger
takes its unverified claims out of reach.

---

### THE OBLIGATION THAT MAKES THIS SAFE

The phase files hold something the code does not: the `Findings`. Those are the measured
corrections — the API that did not behave as documented, the count that was wrong, the
route that could not work, the incident behind an invariant. Deleting them is only
acceptable once each one is **either dead or rehomed**.

Before deleting anything, sweep every `Findings` entry and classify it:

1. **Dead** — it described a transient state of the migration and means nothing now.
   Drop it.
2. **Belongs in the code** — it explains why a line is the way it is. It goes in a
   comment at that line, marked verified or `[unverified]`. A comment is read by the
   person editing the line; a plan file is not.
3. **Belongs in a decision record** — it changed a rule, a boundary, or an
   accepted-tradeoff. Amend or write the record. If the plan shipped against records
   still `proposed`, accept them now; code that assumes an unaccepted decision is code
   resting on nothing.
4. **Belongs in a gate** — it describes a mistake a future edit could repeat. A rule that
   only a retired plan file remembers is not a rule. Install the check, with a fixture
   that is proven to fail.
5. **Still live** — the work is not actually finished. Then the plan is not ready to
   retire; carry the item forward (see below) and say so.

State the classification for every entry. This sweep is the whole of the work; the
deletion is one command.

---

### CARRY-FORWARD

If anything remains — a host that has not been cut over, a decision nobody accepted, a
gate hole — the plan is still load-bearing for exactly those items and nothing else.

Do not keep 700 KB of finished phases alive for one open item. Instead:

1. Author the successor plan (`/create-plan`) with each residual item as a first-class
   phase, carrying its evidence across **in full** — the verified paths, the measured
   command output, the reason it is still open, and precisely what is needed to close it.
   A carried item that arrives without its evidence has to be rediscovered, which is the
   failure the whole plan format exists to prevent.
2. Only then retire the old plan.

The successor plan supersedes; it does not reference. A phase that says "see the old
phase 19" is a dangling pointer the moment you delete it.

---

### RETIRE

1. **Confirm the tree is clean and the gate is green.** Retiring a plan is a commit; it
   should be the only thing in it.
2. **Confirm the history is safe.** The `Findings` survive in git history, which is the
   argument for deleting rather than archiving in-tree — but only if history is actually
   backed up. Check that the off-machine mirror or remote is current. A backup nobody
   has verified is not a backup, and this is the moment it matters.
3. **Delete `.plans/`** in one commit, whose message states what was retired, what was
   rehomed and where, and what was carried forward.
4. **Sweep for dangling references** to `.plans/` — `CLAUDE.md`, `README`, decision
   records, code comments, hooks, CI. A citation of a deleted path is worse than no
   citation: it reads as authoritative.

---

### OUTPUT

1. The `Findings` classification table: entry → dead / code / decision / gate / live,
   with the destination for every rehomed one.
2. What was carried forward, and into which plan.
3. The dangling-reference sweep result.
4. Anything you chose to keep, and why keeping it does not create a second description
   of the tree.
