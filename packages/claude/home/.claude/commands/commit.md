# commit.md

Commit the finished work in the current repo, split into one commit per intent.

**Usage:** `/commit [scope or hint]` — e.g. `/commit only the dns package`, `/commit the
oom fix`. With no argument, commit everything that belongs to the work just finished.
**Stop if** the tree is clean, or the work is half-done, or a check is failing.

---

## 1. Look — cheaply

```sh
git status --porcelain
git diff HEAD --stat
git log --oneline -10
```

`--stat` first, always. Read a full diff only for files whose intent the stat line does
not already make obvious, and exclude generated noise:

```sh
git diff HEAD -- . ':(exclude)*.lock' ':(exclude)*lock.json' ':(exclude)dist/*'
```

A lockfile or a `dist/` diff is thousands of tokens that never change the message — the
stat line is enough. If something is already staged, respect that staging as a signal of
intent.

## 2. Group

One commit per logical change. Rules, in priority order:

- Tests and docs go **with** the code they cover, not in a separate commit.
- An unrelated drive-by fix is its **own** commit.
- Pure formatting / rename churn is its **own** commit, never mixed with behavior.
- Config and dependency bumps stand alone unless a feature in this batch requires them.
- Each commit must leave the tree in a working state — order them so that holds.
- If one file mixes two intents, put it with the group it mostly serves and say so in
  your report. **Never `git checkout` / `git reset --hard` a file to redo work
  hunk-by-hunk** — losing real work costs more than a slightly impure commit.

If the split is more than 4 commits, print the plan (one line each) before running
anything.

## 3. Write the message

Match the repo, not a template. Read the `git log` output from step 1: if recent commits
use Conventional Commits prefixes (`feat:`, `fix(scope):`), match that; if they are plain
imperative sentences, match _that_. The repo's log wins over any convention.

Subject:

- imperative mood — "If applied, this commit will _____"
- ≤50 chars (hard cap 72), no trailing period
- casing follows the log (this repo is lowercase)
- specific: `fix dangling symlink in doctor`, not `fix bug` / `update code`

Body — **default is no body**. Add 1–3 lines, wrapped at 72, only when the diff cannot
answer _why_: a non-obvious constraint, a rejected alternative, a bug this prevents.
Never: a bullet list restating the diff, "Changes:", a test plan, emoji, `Co-Authored-By`,
"Generated with". A commit whose body is a summary of its own diff is a bad commit.

Multi-line messages go through a HEREDOC:

```sh
git commit -m "$(cat <<'EOF'
add swap package for a disk-backed swapfile

zram alone OOMs under a full rebuild; this is the only real capacity.
EOF
)"
```

## 4. Commit

- Run the repo's fast checks first if they exist (`just fmt` / `just check`, or the
  equivalent in `package.json`). Do not commit over a failing check — report it instead.
- `git add <explicit paths>` per group, then commit. Verify with `git status --porcelain`
  that nothing unintended got staged.
- Never amend, rebase, or force-push a commit you did not create in this session.
- Do not push unless the argument asked for it.

## 5. Report

One line per commit, nothing else:

```
a1b2c3d add swap package for a disk-backed swapfile
e4f5g6h fix dangling symlink in doctor
```

Plus one line for anything deliberately left uncommitted and why.
