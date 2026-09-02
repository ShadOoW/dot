---
name: commit
description: |
  How a commit is written on this machine: staging discipline, one commit per intent, and
  the two subject conventions in use — Conventional Commits in /data/config/dot, and
  `scope: sentence` in /data/code/fleet and /data/ops — plus why the body is the norm here
  rather than the exception.
  Use whenever you are about to commit, are asked to commit, are writing or rewriting a
  commit message, are deciding how to split finished work into commits, or are unsure
  whether a repo wants `feat(x):` or `x: …`. Read it before the first `git commit` of a
  session, not after.
---

# Writing a commit here

There is no single machine-wide format. **Derive the subject convention from the repo you
are committing to**, using the measurements below, and never carry one repo's convention
into another.

## 1. Non-negotiable, every repo

- **Stage explicit paths.** Never `git add -A`, never `git add .`, never `git add -u`.
- **Never stage a file you did not touch this session.** Another agent or the operator may
  be editing in the same tree; an unrelated modified file is theirs. Leave it and say so.
- **Never amend, rebase, reset --hard, or force-push a commit you did not create in this
  session.** If a rewrite looks necessary, stop and report.
- **Never push unless asked.** A `post-commit` hook that pushes is not you pushing.
- **Never commit secrets**, `.env`, credentials, or anything under a `state/` directory.
- **No trailers.** No `Co-Authored-By`, no "Generated with", no emoji.
- **Do not commit over a failing check.** Run the repo's own gate first if it is cheap
  (`just check` in dot, `bun run check` in fleet, `./bin/ops check` in ops). If it is red for
  a reason you did not cause, report that instead of committing through it.
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
| `/data/code/fleet` | **`scope: sentence`** — 36/80, only 1 conventional | mean 71, max 159 | `people-web: two listeners, one process, and the index route stops claiming /` |
| `/data/ops` | **`scope: sentence`** — 35/80, 21 conventional | mean 64, max 130 | `matrix: a bridge that rewrites its config owns a file git also owns` |

**Before writing, look:** `git log --format='%s' -40`. Match what you see. If the log is
genuinely mixed, prefer the more recent half.

### Conventional Commits — dot

`<type>(<scope>): <subject>`, type exactly one of `feat fix refactor perf docs test build ci
style chore revert`. Scope is one lowercase noun, the package or module. Breaking change:
`!` before the colon plus a `BREAKING CHANGE:` footer. Keep the whole line ≤72.

### `scope: sentence` — fleet and ops

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

**Write a body.** Measured: 50/60 in fleet, 48/60 in ops, 47/60 in dot. A bare subject is
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
people: the web adapter runs from the fleet workspace

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
a1b2c3d people: the web adapter runs from the fleet workspace
e4f5g6h chore(git): ignore playwright-cli artifacts machine-wide
```

Plus one line for anything deliberately left uncommitted, and whose it is.

## 6. Stop instead of committing when

- the tree is clean;
- the work is half-done, stubbed, or has a `TODO` you introduced;
- a gate is failing;
- the only changes present are someone else's.
