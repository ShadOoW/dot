---
name: commit
description: |
  How a commit is written on this machine: staging discipline, one commit per intent, and
  the two subject conventions in use — Conventional Commits in /data/config/dot, and
  `scope: sentence` in /data/code/logos and /data/ops — plus why the body is the norm here
  rather than the exception.
  Use whenever you are about to commit, are asked to commit, are writing or rewriting a
  commit message, are deciding how to split finished work into commits, or are unsure
  whether a repo wants `feat(x):` or `x: …`. Read it before the first `git commit` of a
  session, not after. In the Bruce work repositories nothing is committed unless the user
  asks; that rule is theirs alone, not this machine's.
---

# Writing a commit here

There is no single machine-wide format. **Derive the subject convention from the repo you
are committing to**, using the measurements below, and never carry one repo's convention
into another.

**Bruce work repositories (`/data/code/work/bruce`) are the exception.** The user reviews the
change in staging and commits it; you commit there only when they ask, in this conversation,
for that commit. Then it is one commit per ticket per repository, its message from
`brucelee`, folded with `git reset --soft`: the `bruce` skill's *Commits* section is the
procedure. This skill's §1 and §6 still apply there; §2–§4 do not. Everywhere else this
machine has no such rule: commit finished work by the repo's own convention.

## 1. Non-negotiable, every repo

- **Stage explicit paths.** Never `git add -A`, never `git add .`, never `git add -u`.
- **Never stage a file you did not touch this session.** Another agent or the operator may
  be editing in the same tree; an unrelated modified file is theirs. Leave it and say so.
- **Never amend, rebase, reset --hard, or force-push a commit you did not create in this
  session.** If a rewrite looks necessary, stop and report.
- **Never push unless asked.** A `post-commit` hook that pushes is not you pushing. The standing
  exception is a plan close that is about to delete a folder: its Findings then exist only in
  history, so the closing session pushes and proves the remote holds the commit (`plans` skill,
  `close.md`).
- **An unpushed state is not news.** Say nothing about a push, or about commits sitting local,
  unless a named consequence exists: another machine has to pull them, a handoff to another person
  depends on them, or a record's only copy is about to leave the tree. "It would be safer backed
  up" is not a consequence and does not earn a sentence — the operator pushes at his own cadence
  and does not need a status line to remember the command.
- **Never commit secrets**, `.env`, credentials, or anything under a `state/` directory.
- **No trailers.** No `Co-Authored-By`, no "Generated with", no emoji.
- **Do not commit over a failing check.** Run the repo's own gate first if it is cheap
  (`just check` in dot, `bun run check:staged` in logos — HEAD plus what is staged, in a
  throwaway copy, inside `nix develop /data/code/logos` — `./bin/ops check` in ops). If it
  is red for a reason you did not cause, report that instead of committing through it. Write a
  long gate's whole output to a file; piped through `tail` or `head`, a red run's failing check is
  lost (cleanup 17b Finding 21).
- **Another session may hold the same index.** It can stage, unstage or rewrite entries you
  never touched while you work, so a shared-index gate checks a tree that is not yours — it
  cost three build attempts in one step (logos 21 Findings 12, 13, 25). Build a private one
  instead: `export GIT_INDEX_FILE=$(mktemp)`, `git read-tree HEAD`, `git add <your paths>`,
  then run the gate with that same variable still exported — `check:staged` honours it.
- **A private index has an order, and the check comes after the commit.** Read it from HEAD as
  late as you can — one read an hour before committing took a file another session had landed in
  the meantime back to its pre-commit content (ticket-flow 03's build). Immediately after the
  commit, `git diff --stat HEAD~1 HEAD` must list only your own paths; that check, not the index,
  is what catches a sweep. Then `unset GIT_INDEX_FILE` and `git reset -q -- <your paths>`, in that
  order: with the variable still exported you reset the private index and leave the shared one
  holding a staged reversal of the commit (ticket-flow 07 Finding 17, 09 Finding 14).
- **Stage after the last write, not before.** `git mv` and `git add` record a file's bytes as they are
  at that moment; a later pass that rewrites the file leaves the index on the old bytes — a cutover
  commit missed six rewritten citations that way and was amended in the same session (workflow 02).
  In dot the pre-commit hook stashes and restores unstaged files ("Stashing unstaged files…"), so a
  commit there does not sweep another session's work but does move the tree mid-commit.
- **On a shared index, commit the paths in one command.** `git commit -- <paths>` takes only
  those paths from the working tree whatever another session has staged; a plain `git commit`
  swept another session's staged deletions into its own commit (cleanup 17b Finding 19). `git
  reset -q -- <paths>` afterwards only for paths nobody else staged: it once unstaged another
  session's change to a file (cleanup 22c Finding 12).
- **A private index pins the tree, never the parent.** If HEAD moves during a long gate, a plain
  `git commit` parents the new commit on the moved HEAD and reverts what landed in between: it
  reverted 17 files of one step (cleanup 22c Finding 21) and deleted another plan's design
  (cleanup 19d). Land it with `git
  commit-tree` and `git update-ref refs/heads/<branch> <new> <old>`, which refuses when HEAD
  moved. An exported `GIT_INDEX_FILE` does not survive from a backgrounded call into the next
  call: build the index, compare its tree with the one `check:staged` named, and commit in a
  single command.
- If a hook rewrites files, re-stage the rewritten paths and commit again. Never
  `--no-verify`.

## 2. Split by intent

One commit per logical change, ordered so every commit leaves the tree working.

- Tests and docs ride **with** the code they cover.
- An unrelated drive-by fix is its **own** commit.
- Pure formatting or rename churn is its **own** commit, never mixed with behaviour.
- Config and dependency bumps stand alone unless a change in this batch requires them.
- If one file mixes two intents, put it with the group it mostly serves and say so. **Never
  `git checkout` or `git reset` a file to redo the split** — losing real work costs more
  than a slightly impure commit.

More than four commits: print the plan, one line each, before running anything.

## 3. Subject — the convention is the repo's, not yours

Measured over the last 60 commits of each, at the time of writing:

| Repo | Convention | Subject length | Read as |
|---|---|---|---|
| `/data/config/dot` | **Conventional Commits** — 70/80 | mean 50, 4/60 over 72 | `chore(git): ignore playwright-cli artifacts machine-wide` |
| `/data/code/logos` | **`scope: sentence`** — 36/80, only 1 conventional | mean 71, max 159 | `people-web: two listeners, one process, and the index route stops claiming /` |
| `/data/ops` | **`scope: sentence`** — 35/80, 21 conventional | mean 64, max 130 | `matrix: a bridge that rewrites its config owns a file git also owns` |

**Before writing, look:** `git log --format='%s' -40`. Match what you see. If the log is
genuinely mixed, prefer the more recent half.

### Conventional Commits — dot

`<type>(<scope>): <subject>`, type exactly one of `feat fix refactor perf docs test build ci
style chore revert`. Scope is one lowercase noun, the package or module. Breaking change:
`!` before the colon plus a `BREAKING CHANGE:` footer. Keep the whole line ≤72.

### `scope: sentence` — logos and ops

`<scope>: <a clause that states what changed and what is now true>`.

- Scope is the app, package, project, or — in ops — a decision number (`0043:`) or several
  scopes (`lake, observability:`).
- The subject is a **sentence fragment, not a label**. It is allowed to be long; the corpus
  mean is 71 characters and the max is 159. Do not truncate a subject that is carrying
  meaning to hit an arbitrary cap.
- Prefer naming the *consequence* over the *action*: `the index route stops claiming /` beats
  `fix route conflict`.
- A phase or plan commit uses the plan's own scope (`plan:`, `phase 09:`).

### Both conventions

- Imperative or present-tense statement — "if applied, this commit will ___".
- Lowercase first word. No trailing period.
- Specific. `fix(doctor): repair dangling symlinks`, never `chore: update code`.

## 4. Body — the norm, not the exception

**Write a body.** Measured: 50/60 in logos, 48/60 in ops, 47/60 in dot. A bare subject is
the minority case on this machine, reserved for changes whose diff is self-evident.

The body answers what the diff cannot:

- **Why**, when the change is not self-evident — the constraint, the incident, the bug it
  prevents.
- **The measurement that proves it.** This machine's house style cites evidence in the
  message: counts, shas, before/after numbers, the command that verified it. `git subtree
  add moves committed history only` and `1823 pass / 148 files` belong here.
- **The alternative you rejected**, and why. One sentence.
- **What a future reader would otherwise rediscover the hard way.**

Never: a bullet list restating the diff, a "Changes:" section, a test plan. A body that
summarises its own diff is noise.

Wrap at 72. Multi-line goes through a heredoc:

```sh
git commit -F - <<'EOF'
people: the web adapter runs from the logos workspace

package.nix names the path only in a comment, so editing it alone would have
restarted onto the old path and then deleted that path.
EOF
```

`git commit -F -` over `-m "$(cat <<'EOF' …)"`: no shell interpolation, so a backtick or a
`$` in the message survives.

## 5. Verify, then report

`git status --porcelain` after staging, to confirm nothing unintended went in. Then one line
per commit:

```
a1b2c3d people: the web adapter runs from the logos workspace
e4f5g6h chore(git): ignore playwright-cli artifacts machine-wide
```

Plus one line for anything deliberately left uncommitted, and whose it is.

## 6. Stop instead of committing when

- the repo is a Bruce work repository and nobody asked for this commit in this conversation;
- the tree is clean;
- the work is half-done, stubbed, or has a `TODO` you introduced;
- a gate is failing;
- the only changes present are someone else's.
