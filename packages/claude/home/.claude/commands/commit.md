# commit.md

Commit the finished work in the current repo, split into one commit per intent, using
the Conventional Commits format below.

**Usage:** `/commit [scope or hint]` — e.g. `/commit only the dns package`, `/commit the
oom fix`. With no argument, commit everything that belongs to the work just finished.
**Stop if** the tree is clean, or the work is half-done, or a check is failing.

Standing rules for every commit made here: stage explicit paths, never `git add -A` /
`git add .`; never stage a file you did not touch; never commit secrets or `.env`; never
amend, rebase, or force-push a commit you did not create in this session; never push
unless asked; no `Co-Authored-By` or "Generated with" trailer.

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

The `git log` is for **context only** — existing scope names, what the recent work was
about. Do **not** copy its message style: the format in step 3 is mandatory even when the
repo's history does not use it.

## 2. Group

One commit per logical change. Rules, in priority order:

- Tests and docs go **with** the code they cover, not in a separate commit.
- An unrelated drive-by fix is its **own** commit.
- Pure formatting / rename churn is its **own** commit, never mixed with behavior.
- Config and dependency bumps stand alone unless a feature in this batch requires them.
- **If a group needs two types (step 3), it is two commits.** One type per commit.
- Each commit must leave the tree in a working state — order them so that holds.
- If one file mixes two intents, put it with the group it mostly serves and say so in
  your report. **Never `git checkout` / `git reset --hard` a file to redo work
  hunk-by-hunk** — losing real work costs more than a slightly impure commit.

If the split is more than 4 commits, print the plan (one line each) before running
anything.

## 3. Write the message

[Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/), always,
regardless of what the repo's history looks like:

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Type** — exactly one, from this list:

| type       | use for                                                     |
| ---------- | ----------------------------------------------------------- |
| `feat`     | a new capability                                            |
| `fix`      | a bug fix                                                   |
| `refactor` | restructuring that preserves behavior                       |
| `perf`     | a change made for speed or resource use                     |
| `docs`     | documentation only                                          |
| `test`     | tests only                                                  |
| `build`    | build system, packaging, dependencies                       |
| `ci`       | CI config and scripts                                       |
| `style`    | formatting only, no change in meaning                       |
| `chore`    | config and housekeeping that fits nothing above             |
| `revert`   | reverting a previous commit (name the reverted sha in body) |

**Scope** — optional, one lowercase noun in parentheses: the package, module, or command
the change lives in (`feat(dns):`, `fix(doctor):`). Omit it when the change is repo-wide.
Reuse a scope name that already exists in the log before inventing one.

**Subject** — the part after `: `

- imperative present tense: `add`, never `added` / `adds` — "if applied, this commit will
  _____"
- lowercase throughout, including the first word and any proper noun that can take it
- no trailing period
- **≤50 chars for the whole line**, prefix included (hard cap 72)
- specific: `fix(doctor): repair dangling symlinks`, not `fix: bug` / `chore: update code`

**Breaking changes** — `!` before the colon (`feat(dot)!: rename link to pkg link`), plus
a `BREAKING CHANGE: <what breaks and what to do>` footer when the subject alone is not
enough.

**Body** — **default is no body.** Add 1–3 lines, wrapped at 72, only when the diff cannot
answer _why_: a non-obvious constraint, a rejected alternative, a bug this prevents.
Never: a bullet list restating the diff, a "Changes:" section, a test plan, emoji. A
commit whose body summarizes its own diff is a bad commit.

Multi-line messages go through a HEREDOC:

```sh
git commit -m "$(cat <<'EOF'
feat(swap): add disk-backed swapfile on engine

zram alone OOMs under a full rebuild; this is the only real capacity.
EOF
)"
```

## 4. Commit

- Run the repo's fast checks first if they exist (`just fmt` / `just check`, or the
  equivalent in `package.json`). Do not commit over a failing check — report it instead.
- If a pre-commit hook rewrites files (formatters do), re-stage the rewritten paths and
  commit again; do not `--no-verify`.
- `git add <explicit paths>` per group, then commit. Verify with `git status --porcelain`
  that nothing unintended got staged.

## 5. Report

One line per commit, nothing else:

```
a1b2c3d feat(swap): add disk-backed swapfile on engine
e4f5g6h fix(doctor): repair dangling symlinks
```

Plus one line for anything deliberately left uncommitted and why.
