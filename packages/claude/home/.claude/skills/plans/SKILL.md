---
name: plans
description: |
  How work that spans sessions is planned and run in a repository on this machine: `.plans/`
  holds one folder per plan (a feature or one body of work), each with its own ledger, memory
  and finish line, opened, run, reviewed and closed on its own. This skill runs every plan
  session, with no command: creating a plan (create.md), designing a step (design.md), building
  it in a fresh session (build.md), running a wave of parallel steps (waves.md), reviewing
  (review.md) and closing (close.md), each a procedure file beside this one. Covers the folder
  layout, the phrases that pick a procedure, the two step depths (consult and inform), what a
  reply may ask of the operator, which model runs each session, what a plan remembers and
  where, and how steps are numbered and cited.
  Use before creating, designing, building, resuming, extending, reviewing or closing a plan,
  or running a wave of one; when the operator says "next step", "design <plan> NN", "build
  <plan> NN", "run wave N of <plan>", "review <plan>" or "close <plan>"; before reading or
  writing anything under a `.plans/` directory; and when new work comes up while a plan is
  running. A plan named by a Jira key (BRC-9080) is a Bruce ticket's: load the bruce-plan
  skill with this one; it says where that plan lives and wins where the two differ.
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
  leftovers/             the carry plan: what closed plans left unfinished (close.md, section 2)
```

- `.plans/` holds plan folders and nothing else. No index file: `ls .plans` lists the open plans
  and `leftovers`, the carry plan every close writes into; `git log --grep '^plan: close'` lists the
  closed ones.
- **A new piece of work is a new folder**, never new steps on a running plan whose "Done when" it
  is outside. A plan may grow steps only inside its own "Done when"; anything else is a new plan,
  or a parked idea (the `ideas` skill).
- Two plans may be open at once. A step that needs another plan's step says so in its
  **Assumes** line, naming both: `cleanup 19d`.
- The step file's format, and the phase format of a plan in waves, are `create.md`'s; this skill
  does not restate them.

## How a plan runs

There is one kind of plan: a ladder of steps run one at a time, each designed in one session and
built in a fresh one. A plan whose steps may run in parallel adds a wave table (`waves.md`); its
first line is `# <plan> — a plan in waves`. Every other plan's first line is `# <plan>`.

| The operator says | The session follows |
|---|---|
| "create a plan for …", "plan …" | `create.md` |
| "design <plan> NN", "design the next step" | `design.md` |
| "build <plan> NN", "build the next step" | `build.md` |
| "next step", "next step of <plan>" | the ledger: the first step not `[x]` — `[ ]` or `[~]` → `design.md`; `[>]` → `build.md`; `[!]` → say what unblocks it and stop |
| "run wave N of <plan>" | `waves.md` |
| "review <plan>", "close <plan>" | `review.md`, `close.md` |

When the plan is not named and `.plans/` holds more than one open plan, the session lists them in
one line and stops; that is the one question it may ask before working.

**A Bruce ticket.** A plan named by a Jira key — "design BRC-9103 01", "build BRC-9080 75", "next step of
BRC-9080" — is that ticket's `plan/` in brucelee's state, not a folder under `.plans/`. Read the `bruce-plan`
skill and its `phase.md` with this skill's procedure file: they map `PLAN.md`, the ledger and History onto a
ticket's dashboard and workstreams, and win wherever they differ from this skill. `create.md`, `waves.md`,
`review.md` and `close.md` do not run on a ticket; `bruce-plan`'s jobs replace them.

**Depth.** Every step has one:

- **consult** — the operator designs this step with the agent. The design session teaches the
  mechanism the step rests on, shows the options with its recommendation, answers his questions,
  and writes the design only after he confirms or corrects it.
- **inform** — the agent designs alone. The design session researches, decides, writes the design
  and tells him in a few lines what the step will build and what the research changed. Launching
  the build is his approval; a correction sent before the build replaces the design.

The words are RACI's (consulted: asked before; informed: told after). The depth is set per step in
the ladder table when the plan is created; the operator changes any step's depth by saying so, and
the session edits the ladder row and adds a History line.

## What a reply may ask of the operator

Only three things, each given as host, command and what to expect when it is an act:
(1) an act that needs his hands, his sudo, or a credential the session must not hold;
(2) his approval for a request to a system he has not cleared in this conversation — his
employer's accounts, production, a paid API beyond the plan's stated budget;
(3) a change to what the plan is for: its Purpose, or the meaning of a Done-when line.

Everything else inside the plan's scope the session decides on its own recommendation, does, and
records in the step's Findings as `Decided: <what> — reverse by <how>`. A one-line fix is made.
Done-when wording that keeps its meaning is corrected, with a History line. A question with
nothing for him to act on is not asked. When nothing qualifies, the reply says
`Needs you: nothing.`

Every reply that ends a session ends with `## Needs you` then `## Next`, in that order; nothing
follows `## Next`.

## Which model runs a session

Every session of a plan starts fresh, so its model is chosen when it is launched, and the
session before it names that choice in its `## Next` line. Judgement is spent in the design, with
the operator in the room; a build that follows a confirmed design is following specific
instructions, which is the work the smaller model does as well for less.

| Session | Model |
|---|---|
| create a plan | Opus 5.5 |
| a design session | Opus 5.5 |
| a build | the step's **Build session** line: Sonnet 5.5 unless it names Opus and why |
| a wave | Opus 5.5 |

**A build gets Opus only for a reason the design names**, one of:

- **unknown cause**: the build has to find out something no design could settle in advance, such
  as a failure with no reproduction yet;
- **unlisted reach**: the change migrates callers or files the design could not list one by one;
- **escalated**: an earlier build of this step had the context, clearly tried, and was still wrong.

A design tempted to name Opus because "the build will have to work it out" has a gap in the
Design section: close the gap instead. Haiku 5.5 runs no plan session; it suits subagent lookups,
not a build bound by a repository's rules. Fable 5.1 runs one only when the operator picks it: it
drains the weekly limit fastest, and on Max past half of it bills usage credits.

**Effort is `high` on both models.** That is Sonnet's own default; on Opus it is one level above
the default (`medium`), because the plans that went well ran their Opus designs at `high`, and the
saving is meant to come from moving builds to Sonnet, not from thinner designs. When a build
fails, ask whether it did not know enough or did not try hard enough (Anthropic's own rule), and
the cause picks the retry:

| The build stopped because | Retry |
|---|---|
| a sentence of the Design section could not be acted on | `design <plan> NN` again: the design is at fault, not the model |
| it had the context, tried, and was still wrong | the same step on Opus; the design's Build session line becomes `escalated` |
| it skipped a file, a gate or a caller, or stopped partway | the same step on the same model at `xhigh` |

**Launch commands**, for omp. `/ss5` switches the session to Sonnet 5.5 and `/so5` to Opus 5.5,
each at `high`; an argument changes it (`/ss5 xhigh`). Both are defined in dot's omp package
(`hooks/pre/model-switch.ts`), which holds the model IDs; when a model ships, change them there
and in the shell form below.

A `## Next` line gives the in-window form, because it skips both the model picker and a new
process. Always include the switch line: `/new` keeps the model but resets effort to omp's
configured level, and the switch sets it back to `high`.

    /new
    /ss5
    build <plan> NN

From a shell instead, one line: `omp --model anthropic/claude-sonnet-5-5 "build <plan> NN"`.

**Why the rule is a default, not a certainty.** Sonnet 5.5 costs half of Opus 5.5 per token
($2/$10 against $4/$20 per million) but can spend more tokens on the same task: in one public
five-run test it wrote twice Opus's output on an agentic bug fix, and its overall saving came to
about 36%, not 50% (The New Stack, 2026-10-08). Every build record names the model and effort it
ran on, and the review counts builds and stops per model (`review.md`): that count, not this
paragraph, is what says whether the rule holds for this operator's plans.

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
   When that runs long it goes under `###` headings at the end of this section: `Before you start`
   (what to check in another plan before a step that assumes it), `Kill criterion` (what makes the
   plan stop and re-cut), `Rejected` (ideas the operator ruled out).
5. **Ledger** — one line per step in run order: `[ ]` pending · `[~]` in design or in progress ·
   `[>]` designed, awaiting build · `[x]` done · `[!]` blocked, saying on whom.
   The only place status lives; step files carry none.
6. **Ladder** — the table (step, name, what it builds, depth, drill), and any note on its order;
   **Established** — one line per landed step: the primitive a later step may assume without
   re-teaching; for a plan in waves, **Waves** and **File-ownership map** (`create.md`);
   **Global invariants** when the plan has rules no step may break.
7. **Open items** — what only the operator, or something outside this repository, can close: a
   ruling awaited, an act needing his credentials, his hands or a machine of his, a wait on a
   person or a system. Each names what closes it and who. What a session can do is not an item:
   it is done now when it is one sitting, and it is a step otherwise. `push owed`, `re-run the
   check`, `re-measure the count` and `read the output` are not the operator's work. Closed items
   are deleted, not struck through. This is the one list; a session's report names items here, it
   does not copy them. What a session may decide or do itself (*What a reply may ask of the
   operator*, above) is never an item.
8. **History** — append-only, one line per session: date · step · what landed or why it stopped ·
   commit.

## What a plan remembers, and where

- **A step's Findings** hold what its sessions measured: surprises, every place the design was
  wrong, the drill and its number, and at the end of a build a short record: what landed, the
  most surprising thing, whether the design was buildable as written. There is no separate
  build log.
- **Current state** holds what a cold reader needs now. **Open items** hold what is unfinished and
  not a session's to do. **History** holds one line per session. Nothing is copied from one
  session's report to the next.
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
  And in `ticket-context` (2026-10-09 to 10-10): none of its 10 designs got an explain-back, and the
  operator dropped its kill criterion at the second. And in `ticket-flow` (2026-10-11 to 10-13): it
  was asked at 6 of its 14 studies and answered at 0, while the plan's own contract said the operator
  "must be able to explain each landed step with the files closed"; its close recorded the clause as
  never measured. And in `cleanup` (2026-10-07 to 10-14): its designs were confirmed with a word and
  no explain-back, under the same clause. The explain-back was removed from the workflow on
  2026-10-14 (workflow 01): a consult step answers the operator's questions instead of asking him
  to recite the design.
- **Probe the live system while designing, not while building.** A script that only passed
  `shellcheck` or a dry run failed against its real target five times in two steps (wrong `PATH`,
  invalid bucket names, `set -e` on an expected exit, a missing binary, a stale group). Run every
  script a design depends on once, against the real target, before the design is confirmed.
  This covers the gate's own commands, run where the gate says: egghead's `published-readme 01`
  named a deploy from the desk that stops at once there (it needs punk), and `meeting-links 01`
  named a command another session's checked-out branches blocked.
  It covers the repository's own lint gates too: `ticket-context 04` designed an exported `Lake` and
  `05` an exported `lineStamp`, and logos' dead-export check failed both builds, the second after
  the first had written the lesson down. A design that exports a name says which file imports it.
- **Re-read the live state when the build starts.** A design's census of authored files is true
  the hour it is taken: `meeting-links 01` designed a cutover of "the two link files that exist",
  and a third was written that morning, between design and build. A cutover over authored files
  lists them again (`ls`, `git status`) before it rewrites any. When another plan's build is writing
  the same files, build in a worktree of HEAD; if that build commits first, re-apply on its content,
  re-gate on the combined tree, and re-read every reading taken on the first tree (`arrival 13`
  Findings 9 and 14).
- **The second copy of a recipe becomes a tool.** The same hand-written gate recipe was rewritten
  five times, and the fifth lost a result; it ended as `bin/snake run`. When a step's gate repeats
  an earlier step's commands, make them a command in the repository first.
- **A reading list states its size in lines.** An unstated cost looks free to accept, which is how a
  step grows too large before anyone can say so.
- **Open items are closed, not copied.** The same uncommitted edit was "left" by ten sessions in a
  row, each copying it into its report. One list in `PLAN.md`; a session that cannot close an item
  names who can.
- **An item two plans share names one owner.** `ticket-context 06` left "should google-meet-ingest
  skip purged records" to the `lake-purge` plan, and `lake-purge` left it to `ticket-context 06`;
  neither would have ruled it. When an Open item points at another plan, that plan's Open items
  say the same owner.
- **A person looks at the first real output.** `personal 07`'s first live recording was cropped to
  the top-left 57% of the screen while every gate on it was green (sha256 equal end to end, a
  transcript in the table); the scene defect was older than the plan and every meeting recording
  had carried it for four days. A live phase's gate includes opening one real output and looking
  at it, not only counting it.
- **The design record lands with the code, in the same session.** `logos` 17 and 18 each wrote the
  design and left it uncommitted while the build ran; a later session then re-designed against the
  tree and the first design was found only in a working tree. The design is a file in the plan
  folder, committed before or with the build.
- **A design's edit list is read against the tree, not counted.** `logos` 17 checked its §9 by
  counting the folders its rule covered instead of opening each file, and the walk it designed
  could not resolve the tree at all; the build had to re-cut it. Checking a claim means opening the
  file and the line.
- **A one-line fix is made, not parked, and the reply asks for whatever the session cannot reach.**
  A parked item is the cheapest thing to write and the last thing anyone reads. retention 01's close
  failed two `check:staged` runs on a one-line defect in `tooling/probes/imports/run.sh` that had
  been a `logos` Open item since 23; the same step's three-file doc correction, its `xattr` answer
  and its home measurement each cost one query. An item is written with its size — `one line`, `a
  step`, `a ruling` — the one-liners are fixed in the session that noticed them, and the rest is
  asked for in that session's reply, where an unanswered question is visible.
- **Before a rename or a move, run `rename-census <old name> <repo>…` and account for every hit.**
  The design carries its output with a line per hit: corrected here, or not mine and why.
  retention 01 §10 asked for "the two stale comments"; five files asserted the old lake layout, and
  the other three were one `grep` away when the design was cut — they surfaced at the build instead,
  as an Open item still open at the close. **A removal is a rename too** (`arrival 10`): grep the
  *concept's prose* over the whole tree, not only the identifier — a provider this plan deleted still
  had its names in `fleet/machines/snake/secrets.nix` and a `docs/VOCABULARY.md` row describing it in
  words.
- **When a plan's Open items double, review them.** `review.md` may run mid-plan, and the moment the
  waiting list grows is when an item is still cheap to turn into a step or a question. Every item
  retention held at 01's close had been created by a session doing the work rather than by the step
  it was running, and none of them needed to wait that long.
- **An Open item names the paths and commands of the day it was written, and goes stale when another
  plan moves them.** At `cleanup`'s review, 7 of its 58 Open items were already closed in the tree or
  named a deleted script folder (`fleet/bin/desktop deploy` after logos 23 removed it), and the
  operator's keepsakes folder was `~/keep`, not the `~/keepsakes` the plan said for a week. A close
  re-verifies every item against the tree and writes it again with today's paths and one line of
  evidence; an item inherited from an earlier plan is verified twice, since its paths predate two
  renames.
- **A session launched on a step that is already `[x]` checks it and stops.** `cleanup 19d` was
  re-launched on a closed step on 2026-10-14; the commit it made from a private index parented on a
  newer HEAD and deleted another plan's design from the tree (repaired the same hour). A step's
  record is the commit that closed it; a second visit changes nothing.
- **A step that waits for another plan's deploy reads the live system, not that plan's ledger line.** `personal 07`
  had deployed to punk and snake while its line still read `[~]`, and three `lake-purge 03` sessions stopped on
  the ledger. The test is a unit, a timer or a start time read where it runs (`lake-purge 03` Findings 12, 23, 24).
- **An operator-only act inside a build's own execution order makes the design two sessions.** `squad 06`
  put punk's `nixos-rebuild switch` — which needs the operator's sudo — inside a sequence its §9.2 called the
  build's, so the build stopped at that step and handed it over, and the before-read it had banked first was
  then the one irreplaceable reading (the job named the lake four minutes after the switch). A design that
  needs such an act takes it *before* the build, with any before-read as late as it can be, or says in its
  execution order that the build returns to the operator at that step.
- **A check's "no hint" rule has to cover every prose source a session can read, plan folders included.**
  `squad 06` discarded a trial only if its session file showed it read `.plans/squad/`, the one folder holding
  the answer key; trial 2 answered the question from `.plans/focus/PLAN.md`'s prose instead, which no rule
  guarded a day after 05's sweep had bounded its census to ticket files, skills and rule packs.
- **Unfinished work has one carry plan, not one per close.** Four closes in a row — `logos` on
  2026-10-13, then `ticket-flow`, `cleanup` and `squad` — each wrote `.plans/<plan>-leftovers/`
  because no open plan owned their items, so `ls .plans` listed four folders that could never close,
  and nothing said which of them held an item. They were merged into `.plans/leftovers/` on
  2026-10-14, and `close.md` section 2 now names that folder as the destination: a close adds to it,
  a step if the item is designed and an Open item under a heading naming its origin otherwise, and
  creates it only when the repository has none.
- **A plan's Open items are the operator's list, not the session's leftovers.** The four carry
  folders merged on 2026-10-14 held 73 items: 38 were rulings, 24 needed the operator's hands or a
  dashboard, and **17 were work a session could have done and none ever did** — "push the commits",
  "re-run the check", "read the output", "re-measure the count". A session that can act acts; a line
  asking the operator to run something an agent can run is noise, and it is what accumulates when
  the end of a session writes down what it could have finished. Four of those 17 were two-line
  fixes. Of the 38 rulings, several were counts that had drifted within the day (104 files holding
  a retired word were 75; 24 unaffirmed decisions were 19): an item carrying a moving count is a
  measurement, and the thing to carry is the one-line decision it implies.
