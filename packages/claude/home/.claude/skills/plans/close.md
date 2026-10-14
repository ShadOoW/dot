# Closing a plan

Once its work has landed, a plan becomes a second description of the tree, and a second
description drifts. Closing is the plan's last step, not housekeeping: what it learned moves
into the places that are read when the code is edited, unfinished work moves to another plan
with its evidence, and the folder is deleted.

A plan is closed only when the operator asks, and only after a review (`review.md`) in the same
session or a recent one with no landed step since.

## 1. Sweep every Finding

The step files hold what the code does not: the API that did not behave as documented, the
count that was wrong, the route that could not work, the incident behind a rule. Deleting them
is acceptable only once each is **dead or rehomed**. Classify every Findings entry:

1. **Dead** — it described a transient state of the work and means nothing now. Drop it.
2. **Code** — it explains why a line is the way it is. It goes in a comment at that line, marked
   verified or `[unverified]`. A comment is read by the person editing the line; a plan file is
   not.
3. **Decision** — it changed a rule, a boundary or an accepted trade-off. Amend or write the
   decision record; accept any the code already assumes.
4. **Check** — it describes a mistake a future edit could repeat. A rule only a deleted plan
   remembers is not a rule: install the check, with a fixture proven to fail.
5. **Repository skill or this skill** — a lesson about working in this repository goes in its
   skill; a lesson about planning goes in this skill, so the next plan inherits it.
6. **Live** — the work is not finished: carry it (below).

A Finding already cited from the code by step name (`meetings 21l` Findings 25) is already
rehomed: the citation reaches it through `git log`. Classify those as code without moving
them.

Many plans hold thousands of entries. Split the sweep across read-only agents by step range;
each returns a table `step · entry · class · destination · the exact text to add`. Apply the
edits yourself, one owner per destination file, so no two agents edit one file.

## 2. Carry what is unfinished

If anything remains (a step not done, a ruling awaited, a defect noticed), it goes into another
plan as a first-class step or Open item, **with its evidence in full**: the verified paths, the
measured output, why it is open, and exactly what closes it. A carried item that arrives without
its evidence has to be rediscovered. A step file carried whole keeps its number and moves with
`git mv`. The successor never cites the closed plan's files: they are about to be deleted.

**Carry only what the operator, or something outside this repository, owns.** Before writing an
item, ask who closes it. If a session can — a defect, a check to write, a comment to correct, a
count to re-take, a push — then it is not an Open item: it is done in this session when it is one
sitting, and a step otherwise. Never write a line that asks the operator to run something a session
can run. The four carry folders merged on 2026-10-14 held 73 items, 17 of them work a session could
have done; four of those were two-line fixes, and the same folders carried counts that had already
drifted.

**The plan it goes into is the repository's carry plan, `.plans/leftovers/`, unless an open plan
already owns the item** — a plan whose "Done when" covers it, or which already holds it. Create
`.plans/leftovers/` only when the repository has none; otherwise add the item to it: a step if the
item is designed, else an Open item under a heading naming the plan just closed, plus one History
line for the close. Four closes in a row (logos, ticket-flow, cleanup, squad) each wrote
`.plans/<plan>-leftovers/` instead, and four such folders were merged back into one on 2026-10-14:
`ls .plans` had stopped naming the plans, and no session could tell which folder held an item. A
second carry list is the one nobody reads. The carry plan is drained the same way anything else is
— the item becomes a step of a plan that owns its area, is parked in the ideas repository, or is
done — and it is never deleted by a close that is not its own.

Deferred work the operator has said to park goes to the ideas repository (the `ideas` skill),
quoting the operator's words. Without those words it is an Open item of a plan, and the close
report asks the operator.

## 3. Retire

1. **History is safe.** The Findings survive only in git history, which is the argument for
   deleting rather than archiving in the tree, but only if history is backed up: push, and check
   the remote holds the commit before deleting.
2. **No citation into the folder survives outside `.plans/`.** Rewrite each to the step's name
   (`<plan> NN`, with its section). A citation of a deleted path is worse than none: it reads as
   authoritative.
3. **Delete the folder** in one commit, alone or with the rehoming edits:
   `plan: close <plan> — <what it delivered>`. The body holds the retrospective in a few lines,
   what was rehomed and where, and what was carried into which plan.
4. Gates green before and after the commit.

## Output

1. The classification: counts per class, and for every rehomed entry its destination.
2. What was carried, into which plan.
3. The citation sweep's result: zero paths into the folder outside `.plans/`.
4. Anything kept, and why it does not become a second description of the tree.
5. Nothing asked of the operator that a session can do: every such item was done here or made a
   step, and the report says which. A `push` is not asked for — the operator pushes at his own
   cadence and a session never pushes unasked (the `commit` skill) — and neither is a check to
   re-run, a count to re-take, or a file to read.
