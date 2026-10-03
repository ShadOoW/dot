---
name: ideas
description: |
  Where ideas the operator decided not to do yet are kept, for every project on this
  machine: /data/code/ideas, one file per idea with why it waits, what brings it back and
  when it expires. Use before writing a plan, a phase or a proposal (read the project's
  parked and rejected ideas first, so nothing already decided comes back as new); when the
  operator says park it, not now, later, or drops a phase or proposal that is worth
  remembering; and when a parked idea's trigger may have fired. Not for work repositories
  under /data/code/work: their ideas belong to the work's own tracker.
---

# ideas

The repository is `/data/code/ideas`, and its `README.md` is the whole procedure: layout, the
file format, who may park an idea, expiry, and how several sessions commit at once. Read it
before writing there; do not restate it into other files.

Before proposing work in a project, list what is already decided for it:

grep -rl --include='2*.md' '<project path>' /data/code/ideas
```
