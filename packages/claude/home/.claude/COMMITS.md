# Committing

Commit when a piece of work is **finished and verified** — never per turn, never
mid-task, never with a failing check. If the work isn't done, leave the tree dirty.

**One commit per intent.** Work that produced two unrelated changes (a feature and a
drive-by fix, code and an unrelated reformat) is two commits. Stage each group's paths
explicitly: `git add <paths>`. Never `git add -A` / `git add .`, never stage a file you
did not touch, never commit secrets or `.env`.

**Message** — copy the house style from `git log --oneline -10` first. Subject line
only: imperative, ≤50 chars, no trailing period (`add dns package`, not
`Added DNS package.`). Add a body only when the _why_ is invisible in the diff — 1–3
lines wrapped at 72. Never a bullet list restating the diff, a "Changes:" section, a
test plan, or emoji. No `Co-Authored-By`, no "Generated with" trailer.

Do not push, amend, rebase, or force anything unless asked. `/commit` runs the full
grouped flow on demand.
