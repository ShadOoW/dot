# Designing one step

The operator says `design <plan> NN`, `design the next step`, or `next step` when the ledger's
first open step is `[ ]` or `[~]`. You design that one step of the plan in `.plans/<plan>/` (layout,
memory, depth and replies: `SKILL.md`, beside this file), check the design against primary sources
and against how the field solves the problem today, and **write it down**. You do not implement
anything. A build session builds it later, in a fresh session, from what you wrote (`build.md`).

---

## The one rule

**You write nothing but the plan folder: the step file, and the ledger, Current state and History
in `PLAN.md`.** No implementation, no scaffolds, no "while I was here".

The dominant failure of a design session is an agent that helpfully designs, implements and tests
in one breath, then presents finished work for a nod. That produces code nobody designed on
purpose. A run that lands implementation code is a failed run regardless of the code's quality.

The second failure is designing from memory. **Every factual claim carries its source** — a
path:line in this tree, a man page, vendored source, or observed command output. Anything you could
not verify is marked `[INFERENCE]` inline. Prefer this tree's exemplars over general examples, and
prefer reading the source over describing it.

**Probe the live system while designing, not while building.** Run every script and gate command
the design depends on once, against the real target, before the design is written (the `plans`
skill's lesson of the same name).

---

## Sequence

1. **Start.** Read the `plans` skill, `PLAN.md` (Current state, ledger, Established, Open items),
   the step file and its reading list. The step must be `[ ]` or `[~]`; if it is `[>]` or `[x]`,
   say so and stop (the lesson about a session launched on a closed step). Set `[~]`. The step's
   depth is its row in the ladder table.
2. **Draft** the design from the tree, probing what it depends on.
3. **Research**, before anything is shown. Skip it only when the step touches no outside system (a
   rename, copied text); then the Research section says so in one line. Otherwise:
   - Write down the assumptions the draft rests on about outside systems — tools, libraries,
     protocols, vendors, standards — each as a question.
   - Run two subagents in one batch, each with a fresh context. **Neither is given the draft.**
     - **Fact check.** Input: the questions only. Output: an answer to each from primary sources —
       the official docs at the version in use, the source code, the standard, the tool's own
       `--help` or man page — with the link or path and the date read; an answer it cannot source
       is marked unverified.
     - **Field survey.** Input: the problem in plain words (what must be true for the user when the
       step is done) and the versions actually in use, read from the tree (for example the nixpkgs
       pin in `flake.lock` and the systemd it ships; a `package.json`). Output: the current best
       ways to solve it, each with sources — release notes and changelogs of those tools (features
       newer than the model's training), how established projects or products solve the same
       problem, the maintainers' own current guidance — and whether each is available at the
       versions in use.
   - **Revise.** Every fact-check answer that contradicts the draft changes it. Every survey option
     is adopted, or gets one line on why not: not available at our version, conflicts with a house
     rule (named), or not worth its cost.

   Why the draft is withheld: the answers then cannot repeat the draft's errors, and the draft was
   not anchored on whatever the first articles said (Chain-of-Verification, `workflow 01`'s
   Research section).
4. **Naming.** The words this step introduces. Check each: is there a standard word in its home
   field; is the candidate already load-bearing somewhere in this tree with a different meaning;
   what alternatives were rejected. Follow the repository's vocabulary policy where it has one. A
   colliding word misleads worse than an unfamiliar one. Grep before asserting a word is free. The
   result goes in the Naming section; the reply mentions a name only when the operator will see it
   in use.
5. **Reply.**
   - First line: what the step will build, in the operator's terms.
   - **consult**: the mechanism (the problem it solves, what existed before, the smallest example
     from this tree, failure modes, cost); then the options as the recommended one plus one line
     per rejected one; then an invitation to ask anything; it ends by waiting for confirm or a
     correction. A correction is the design, not a variant to argue back.
   - **inform**: how it works, in three to five lines.
   - Both: one line on what the research changed ("checked; nothing changed" is a valid line).
   - Never in the reply: the design itself (it is in the file), a quiz, a "state it back".
   - `## Needs you` per the `plans` skill, then `## Next`.
6. **Write.** consult: after the confirm. inform: at once, before replying. Fill the Research,
   Naming and Design sections; set `[>]`; rewrite Current state; one History line; commit the plan
   folder's files (`plan: <plan> — NN designed: <what it will build>`), on a private index (the
   `commit` skill) — the design lands committed (the lesson about uncommitted designs).
7. **Next**, from the ledger read again now: the in-window form `/new`, the switch for the step's
   Build session model (`/ss5` or `/so5`), `build <plan> NN`, and one sentence on why a new
   session: the build must work from the file alone. Waiting on a consult confirm: "reply here with
   confirm or your correction". A re-split: the ledger change, then `design <plan> MM` in a new
   session on Opus.

---

## The Design section

**It is the entire input to a session that has none of this conversation.** Write it for that
reader: exact paths, exact names, exact contracts, the decisions and their reasons. If you would
need to be in the room for it to be buildable, it is not finished. That completeness is
deliberately also the test of the design — a fresh session that cannot build from it has found
vagueness nobody noticed.

**It opens with one line naming the model that builds it:** `**Build session:** Sonnet 5.5`, or
`**Build session:** Opus 5.5 — <reason>`, where the reason is one of the three the `plans` skill
lists under _Which model runs a session_, with the fact that makes it apply. Sonnet is the default,
and it is a test of the same completeness: a design that only the larger model could build is
usually a design with a gap, so close the gap before reaching for the model. In a consult step, say
the choice to the operator before the confirm.

Two rules bind it (the repository's own rules, which the plan's House rules point to). A gate waits
for a timer's own run only when this step adds or changes that timer, its unit or its status unit;
otherwise it runs on a start by hand, and a timer run that must be seen is handed forward to the
next session, never waited for. And anything only the operator can do that does not depend on the
build goes first in the execution order.

---

## Constraints

- **One step per run.** If the work reveals the step is two steps, stop, say so, and propose the
  re-split. Do not quietly design both.
- **If the plan is wrong, say so.** A step whose premise no longer holds is a finding: record it in
  the step's Findings and propose the plan change rather than designing around it.
