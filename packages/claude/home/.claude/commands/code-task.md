# code-task.md

Apply the task in $ARGUMENTS. Optimize for first-attempt correctness — no review gates.

**Usage:** `/code-task [absolute path] [task]` — the task text may hint at a base file ("based on X", "like Y", "X vs Y", a bare path).
**Stop if no coding task is identifiable.**
**Success criterion:** all files written, enforce check clean, tsc + eslint clean, i18n complete, audit log (incl. templates + divergences) complete.
**Markers:** `// [lesson: "title"]` and `// [novel: description]` stay in delivered code.
`{intent: enforce}` = hard rule, fix violations on sight.
**Standing principle:** matching existing code beats abstract improvement — copy the established idiom; do not invent a better one mid-task.

---

## 0. Preflight

Parse $ARGUMENTS: first `/`-rooted token = project path; remainder = task.
Also extract **template hints** from the task text ("based on", "like", "copy", "same as", "X vs Y", any file path). Hold for step 2 — developer hints are authoritative.

```bash
cd [path] && git rev-parse --is-inside-work-tree 2>&1
git log --pretty=format: --name-only | grep -v '^$' | head -3
curl -s http://localhost:3111/agentmemory/health | jq -r '.status'
```

Derive **path prefix** from git log (leading path segment common to all listed files, e.g. `code/src`).
Stop on failure: `STOPPED: [what] unreachable. Fix: [command]`

---

## 1. Lessons

Load lessons **before any file exploration**. Wait for results.

```
memory_smart_search("[v1] confidence rule evidence", limit: 50)
memory_smart_search("{intent: enforce}", limit: 20)
```

Hold enforce titles for step 4. Warn if both return 0.

---

## 2. Plan + Explore

**A. Plan files:**

| Class          | Trigger                                               |
| -------------- | ----------------------------------------------------- |
| CREATE         | New file                                              |
| MODIFY line    | ≤5 lines, no new named region                         |
| MODIFY section | New named region OR >20 lines rewritten in one region |

- **Paired:** `index.tsx` + `views.tsx` + `setup.ts` in same folder = one unit.
- **Component type:** name it (e.g. `CreateForm`). Used in lesson queries.
- **Write order:** exporters before importers.

**B. Template per CREATE file — resolve in this order, stop at the first hit:**

1. **Developer hint** from step 0 — always wins; never substitute your own candidate.
   Resolve fuzzy hints to a path: `git ls-files | grep -i [name]`. A hint naming one
   file assigns the whole paired unit to that template's folder siblings.
   If a hint resolves to nothing, flag it in the file plan
   (`Template hint "[text]" unresolved — using [auto-selected]`) and fall through.
2. **Auto-select** (only when no hint): rank same-role candidates (same basename +
   structural position, e.g. `Feature/*/List/setup.ts`) by closeness to the task.
   **Prefer the exemplar the project's docs point at** (AGENTS.md "Recent Patterns",
   migration guides) over the merely-closest file — never template from a
   deprecated/legacy pattern. Skim the winner before committing to it: a wrong
   template costs more than the search.
3. **NONE:** no credible template — build from standards + nearest precedent.

**C. Explore — read in this order, stop when sufficient:**

1. **Template file** (from B): read fully — to learn the transformation points, not to retype it.
2. **Parent file:** the controller or view you are modifying. Read only the sections you will edit.
3. **Types:** grep for key interfaces — read only the relevant declaration block.

**Hard limit: at most 5 full file reads in the parent thread.** Use `grep`/`bash` for everything else. Copying a template (step 3) does not count as a read.

Output the file plan inline — each CREATE row names its template (and whether developer-specified or auto-selected) — and proceed immediately.

---

## 3. Write

Files in write order. One section at a time. Apply loaded lessons.

**CREATE with template = copy first.** Start from a literal copy (`cp template new`),
then transform minimally: domain renames, scoping, dropping blocks the objective
does not need. A file whose role matches the template exactly should end
byte-identical. Every divergence beyond mechanical renames needs a task-tied
reason — log it for step 6.
**Queries:** copy the tenant/permission filter shape from the template or nearest
precedent — never write a weaker where-clause than the file you copied from.

**After writing each file — novel scan (run before moving to the next file):**
Scan every line written — for CREATE-with-template, scan the diff vs the template,
not the whole file. Add `// [novel: description]` on the line for each:

- Hardcoded string literal, ID, objectId, magic value, or language code
- Any `as X` type cast
- Import from a path containing `DEPRECATED`
- Local enum or type that may already exist in a library package
- Constant borrowed from a sibling module rather than defined in this file or a shared location
- New prop whose name uses a different convention than its siblings in the same interface
- Behavioral change in a file outside your current session's writes (even when fixing a type error)
- New i18n key reference — immediately add the key to the translation file before continuing

**`// [lesson: "title"]`** — only when a developer without that lesson would plausibly write this differently.

MODIFY line: write the change; marker only if an enforce lesson directly applies.

---

## 4. Enforce check

Enforce sources: lesson titles from step 1, plus the project's AGENTS.md
"Mandatory Coding Standards" when present. Fix violations immediately.

```
Enforce check:
  "[title]" — clean | fixed at [description]
```

---

## 5. Verify

```bash
cd [project path] && npx tsc --noEmit 2>&1 | grep "error TS" | head -20
npx eslint [written files] --quiet
```

Fix every type or lint error **in files you wrote this session**.
If `tsc` surfaces errors in files you did not write: list them in the audit log as "out-of-scope errors" — do not fix them silently.

Confirm:

- [ ] Every symbol in written files appears in its import block
- [ ] Every `// [novel: ...]` from the post-write scans is present
- [ ] Every new i18n key has a corresponding translation entry
- [ ] `tsc --noEmit` and eslint exit clean on files you wrote
- [ ] Every CREATE-with-template file: `diff [template] [file]` re-read — every hunk maps to a logged divergence

---

## 6. Audit log — do not end the task without this

```
## Audit log

### [file]
Template: [path] (developer-specified | auto-selected) | NONE
Divergences from template: [what — why the objective needs it] | none (byte-identical)
Sections: [in write order]
Lessons applied: "[title]" — [section] | none
Enforce fixes: [list] | none
Novel decisions: [section]: [description] | none
Out-of-scope errors: [file:line error] | none
```

If the session ends in a commit, add one trailer line per derived unit to the
commit body — the review command reads them before running its own detection:

```
Template: [new path] <- [template path]
```

If any novel decisions were logged:

```
## Candidates for learn-from-commits

CANDIDATE: [section] in [file]
Pattern: [what was done and why]
Anti-pattern: [what a developer writes without this knowledge]
```
