# code-task.md

Apply the task in $ARGUMENTS. Optimize for first-attempt correctness — no review gates.

**Usage:** `/code-task [absolute path] [task]`
**Stop if no coding task is identifiable.**
**Success criterion:** all files written, enforce check clean, tsc clean, i18n complete, audit log complete.
**Markers:** `// [lesson: "title"]` and `// [novel: description]` stay in delivered code.
`{intent: enforce}` = hard rule, fix violations on sight.

---

## 0. Preflight

Parse $ARGUMENTS: first `/`-rooted token = project path; remainder = task.

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

| Class | Trigger |
|-------|---------|
| CREATE | New file |
| MODIFY line | ≤5 lines, no new named region |
| MODIFY section | New named region OR >20 lines rewritten in one region |

- **Paired:** `index.tsx` + `views.tsx` + `setup.ts` in same folder = one unit.
- **Component type:** name it (e.g. `CreateForm`). Used in lesson queries.
- **Write order:** exporters before importers.

**B. Explore — read in this order, stop when sufficient:**

1. **Mirror file:** the closest existing counterpart (e.g. `MissionTemplate/index.tsx` when building `AssignmentTemplate/index.tsx`). Read fully.
2. **Parent file:** the controller or view you are modifying. Read only the sections you will edit.
3. **Types:** grep for key interfaces — read only the relevant declaration block.

**Hard limit: at most 5 full file reads in the parent thread.** Use `grep`/`bash` for everything else.

Output the file plan inline and proceed immediately.

---

## 3. Write

Files in write order. One section at a time. Apply loaded lessons.

**After writing each file — novel scan (run before moving to the next file):**
Scan every line written. Add `// [novel: description]` on the line for each:
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

Using enforce titles from step 1. Fix violations immediately.
```
Enforce check:
  "[title]" — clean | fixed at [description]
```

---

## 5. Verify

```bash
cd [project path] && npx tsc --noEmit 2>&1 | grep "error TS" | head -20
```

Fix every type error **in files you wrote this session**.
If `tsc` surfaces errors in files you did not write: list them in the audit log as "out-of-scope errors" — do not fix them silently.

Confirm:
- [ ] Every symbol in written files appears in its import block
- [ ] Every `// [novel: ...]` from the post-write scans is present
- [ ] Every new i18n key has a corresponding translation entry
- [ ] `tsc --noEmit` exits with zero errors in files you wrote

---

## 6. Audit log — do not end the task without this

```
## Audit log

### [file]
Mirror used: [path] | NONE
Sections: [in write order]
Lessons applied: "[title]" — [section] | none
Enforce fixes: [list] | none
Novel decisions: [section]: [description] | none
Out-of-scope errors: [file:line error] | none
```

If any novel decisions were logged:
```
## Candidates for learn-from-commits

CANDIDATE: [section] in [file]
Pattern: [what was done and why]
Anti-pattern: [what a developer writes without this knowledge]
```
