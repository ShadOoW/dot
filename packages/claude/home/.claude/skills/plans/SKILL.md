---
name: plans
description: |
  How work that spans sessions is planned in a repository on this machine: `.plans/` holds one
  folder per plan (a feature or one body of work), each with its own ledger, memory and finish
  line, opened, run, reviewed and closed on its own. Covers the folder layout, the two kinds of
  plan (build, run by /create-plan and /execute-wave; study, run by /create-study-plan, /study and
  /execute-study-step), what a plan remembers and where, how steps are numbered and cited, and
  the review and close procedures (review.md, close.md beside this file).
  Use before creating, reading, resuming, extending, reviewing or closing anything under a
  `.plans/` directory; when the operator asks to review or close a plan; and when new work
  comes up while a plan is running. Not for Bruce tickets: their plans live in brucelee's state
  and follow the bruce-plan skill.
---

# Plans

A plan is scaffolding for work in flight. It has a finish line written on day one, it is
reviewed against what the tree actually holds, and when it is done it is closed: what it learned
moves into the code, the decisions and the checks, and the folder is deleted. A plan that never
closes grows into a roadmap nobody can read: egghead's first plan went from 16 steps to 101 in
three weeks and wrote 81,000 lines of markdown beside 33,000 of code, because adding the next
feature to it was always the easy path.

## Layout

```
.plans/
  <plan>/                one folder per plan, a short lowercase name: cleanup, meetings
    PLAN.md              the plan's index and its whole memory
    NN-<name>.md         one file per step or phase, ending in its Findings
```

- `.plans/` holds plan folders and nothing else. No index file: `ls .plans` lists the open plans,
  `git log --grep '^plan: close'` the closed ones.
- **A new piece of work is a new folder**, never new steps on a running plan whose "Done when" it
  is outside. A plan may grow steps only inside its own "Done when"; anything else is a new plan,
  or a parked idea (the `ideas` skill).
- Two plans may be open at once. A step that needs another plan's step says so in its
  **Assumes** line, naming both: `cleanup 19d`.

## Two kinds of plan

| Kind | When | Created by | Run by |
|---|---|---|---|
| build | the agent rediscovering nothing matters most; phases may run in parallel | `/create-plan <plan>` | `/execute-wave <plan> <wave>` |
| study | the operator must be able to explain the result; one step at a time | `/create-study-plan <plan>` | `/study <plan> NN`, then `/execute-study-step <plan> NN` |

The step and phase file formats are the commands' own; this skill does not restate them. A plan
says its kind in its first line: `# <plan> — a build plan` or `# <plan> — a study plan`.

## PLAN.md, in order

1. **Purpose** — what is true for the person using the system when this plan is done, in plain
   words, under 150 words.
2. **Done when** — the finish line, countable where possible, written when the plan is created.
   Changing it is the operator's call and gets a History line.
3. **Current state** — at most 15 lines, **rewritten** (never appended) at the end of every
   session: what is done, what is next and by which command, what is blocked and on whom. A
   resuming session reads this and the ledger before opening anything else.
4. **House rules** — a pointer to the repository's own rules (its skill, AGENTS.md, README), plus
   only what is particular to this plan. Never a copy of the repository's rules: copies drift.
5. **Ledger** — one line per step in run order: `[ ]` pending · `[~]` in design or in progress ·
   `[>]` designed, awaiting build (study plans) · `[x]` done · `[!]` blocked, saying on whom.
   The only place status lives; step files carry none.
6. The kind's own sections: the wave table and file-ownership map of a build plan; the ladder
   table, kill criterion and **Established** list of a study plan (one line per landed step: the
   primitive a later step may assume without re-teaching).
7. **Open items** — every ruling awaited, push owed, defect noticed and not fixed, each with what
   closes it and who. Closed items are deleted, not struck through. This is the one list; a
   session's report names items here, it does not copy them.
8. **History** — append-only, one line per session: date · step · what landed or why it stopped ·
   commit.

## What a plan remembers, and where

- **A step's Findings** hold what its sessions measured: surprises, every place the design was
  wrong, the drill and its number, and at the end of a build a short record: what landed, the
  most surprising thing, whether the design was buildable as written. There is no separate
  build log.
- **Current state** holds what a cold reader needs now. **Open items** hold what is unfinished.
  **History** holds one line per session. Nothing is copied from one session's report to the
  next.
- **Lessons that outlive the plan** are not kept in it: at close they move into code comments,
  decision records, checks, the repository's skill, or this skill (`close.md`).

## Numbers and citations

- A step is named `<plan> NN`: `cleanup 03`, `meetings 21l`. Numbers are the plan's own, never
  reused; a step carried in from a closed plan keeps its number and its file name's `NN`.
- **Nothing outside `.plans/` cites a file inside it.** Code, decisions and docs cite the step by
  name (`meetings 21l`, §9.3), which `git log --grep '^meetings 21l:'` resolves to the commit
  that built it, and that commit holds the step file as it was. A plan folder can then be deleted
  without breaking a citation. Inside `.plans/`, a step cites another by name as well.
- Commits follow the repository's convention with the step as its scope: `cleanup 03: offsite —
  <what is now true>` where the repository writes `scope: sentence`; planning commits are
  `plan: <plan> — <what changed>`, and closing is `plan: close <plan> — <what it delivered>`.

## Review and close are the operator's to start

Run them only when the operator asks, by name or with `/skill:plans`:

- **Review** (`review.md`): an adversarial check of every `[x]` against the tree, and a
  retrospective with numbers. It may run mid-plan; it always runs before a close.
- **Close** (`close.md`): every Finding rehomed or declared dead, unfinished work carried into
  another plan with its evidence, then the folder deleted in one commit.

## When new work turns up mid-plan

Inside "Done when": a new step in the same plan. Outside it: say so to the operator and propose
either a new plan folder or a parked idea. Never extend the running plan to absorb it.

## What closed plans taught

Each line cost a plan real sessions. Read them before writing a step or a gate.

- **A measure that never produces a reading is worse than none.** egghead's first plan pre-registered
  three explain-back questions per step and a kill criterion on them; 64 build replies listed the
  questions and none was answered, so the criterion could never fire. Ask a question in the session
  that needs the answer, or drop it. It happened again in egghead's `published-readme` and
  `meeting-links` (2026-10-09): both designs were confirmed without the explain-back, and both
  plans carried a kill criterion counting failed explain-backs that therefore never had a reading.
- **Probe the live system while designing, not while building.** A script that only passed
  `shellcheck` or a dry run failed against its real target five times in two steps (wrong `PATH`,
  invalid bucket names, `set -e` on an expected exit, a missing binary, a stale group). Run every
  script a design depends on once, against the real target, before the design is confirmed.
  This covers the gate's own commands, run where the gate says: egghead's `published-readme 01`
  named a deploy from the desk that stops at once there (it needs punk), and `meeting-links 01`
  named a command another session's checked-out branches blocked.
- **Re-read the live state when the build starts.** A design's census of authored files is true
  the hour it is taken: `meeting-links 01` designed a cutover of "the two link files that exist",
  and a third was written that morning, between design and build. A cutover over authored files
  lists them again (`ls`, `git status`) before it rewrites any.
- **The second copy of a recipe becomes a tool.** The same hand-written gate recipe was rewritten
  five times, and the fifth lost a result; it ended as `bin/snake run`. When a step's gate repeats
  an earlier step's commands, make them a command in the repository first.
- **A reading list states its size in lines.** An unstated cost looks free to accept, which is how a
  step grows too large before anyone can say so.
- **Open items are closed, not copied.** The same uncommitted edit was "left" by ten sessions in a
  row, each copying it into its report. One list in `PLAN.md`; a session that cannot close an item
  names who can.
- **A person looks at the first real output.** `personal 07`'s first live recording was cropped to
  the top-left 57% of the screen while every gate on it was green (sha256 equal end to end, a
  transcript in the table); the scene defect was older than the plan and every meeting recording
  had carried it for four days. A live phase's gate includes opening one real output and looking
  at it, not only counting it.
