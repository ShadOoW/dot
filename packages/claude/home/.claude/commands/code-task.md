# code-task.md

Apply the task in $ARGUMENTS. Optimize for first-attempt correctness — no review gates.

**Usage:** `/code-task [absolute path] [task]`
**Stop if no coding task is identifiable.**
**Success criterion:** all files written, enforce check clean, tsc clean, audit log complete.
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

## 1. Plan + Explore

Classify every target file:

| Class | Trigger |
|-------|---------|
| CREATE | New file |
| MODIFY line | ≤5 lines, no new named region |
| MODIFY section | New named region OR >20 lines rewritten in one region |

- **Paired:** `index.tsx` + `views.tsx` + `setup.ts` in same folder = one sub-agent unit.
- **Component type:** name it (e.g. `CreateForm`). Used in lesson queries.
- **Domain keyword:** first path segment right-of-filename matching `Form|Select|List|Page|Modal|Picker|View|Field`.
- **Write order:** exporters before importers.

**Read the key files needed to understand the task** — types, related components, existing patterns.
Do this in the parent thread before dispatching sub-agents.
The richer the pre-write context, the better the output.

Output the file plan inline and proceed immediately.

---

## 2. Lessons + Templates — parallel

Run A and B in parallel:

**A. Load lessons (parent thread):**
```
memory_smart_search("[v1] confidence rule evidence", limit: 50)
memory_smart_search("{intent: enforce}", limit: 20)
```
Hold enforce titles for step 4. Warn if both return 0.

**B. Template sub-agents** — one per CREATE file (paired = one), one per MODIFY section.

Build candidate pool per file in the parent thread (bash only, no Read):
```bash
git log --pretty=format: --name-only \
  | grep "[PATH_PREFIX].*FILENAME$" | grep -v '^$' \
  | awk '!seen[$0]++' | head -15
# when domain keyword exists, also:
git log --pretty=format: --name-only \
  | grep "[PATH_PREFIX].*DOMAIN.*FILENAME$" | grep -v '^$' \
  | awk '!seen[$0]++' | head -10
```
Deduplicate, exclude target files, cap at 15.

**Sub-agent prompt — CREATE single file:**
```
Structural template selection — read structure only, ignore logic.
File: [path] | Task: [one sentence] | Candidates (most recent first): [≤15]

1. Cat candidates in order. Stop after 5 or on clear match.
2. Extract top-level section names and order.
3. Sections with >3 internal declaration types: also extract type order.
4. No match → Augment query "[component type] section structure". Mark NONE.
5. memory_smart_search("[section] [component type] react", limit:8) for each section.

Return (≤200 tokens):
Template: [path] | NONE
Sections: 1.[name] 2.[name] ...
Within-section (if confident): [section]: 1.[type] 2.[type] ...
Lessons per section: [section] → [titles] | none
```

**Sub-agent prompt — CREATE paired (index.tsx / views.tsx / setup.ts):**
```
Structural template selection — read structure only.
Files: [list] — must come from one source folder. | Candidates: [≤15]

1. Find a source folder with the same filenames. Cat up to 5 folders.
2. index.tsx: section order + within-section type order for callbacks/effects.
   views.tsx / setup.ts: section order only.
3. No match → Augment query per file. Mark NONE.
4. memory_smart_search("[section] [component type] react", limit:8) per section.

Return (≤250 tokens):
Template folder: [path] | NONE
[filename] sections: 1.[name] 2.[name] ...
index.tsx [section]: 1.[type] ... (only if >3 types and confident)
Lessons per section: [section] → [titles] | none
```

**Sub-agent prompt — MODIFY section:**
```
Structural template selection — read structure only.
File: [path] | Section to add: [name] | Task: [one sentence] | Candidates: [≤15]

1. Cat candidates in order. Check up to 8 files.
2. When target section found: extract internal type order and flanking sections.
3. memory_smart_search("[section] [component type] react", limit:8).

Return (≤120 tokens):
Template: [path] | NONE
Internal order: 1.[type] 2.[type] ...
Position: after [section] before [section]
Lessons: [titles] | none
```

Output template verdicts and lesson map inline, then proceed.

---

## 3. Write

Files in write order. One section at a time. Use sub-agent lesson results — no new memory queries.

**`// [novel: ...]` — mandatory, no exceptions:**
- Hardcoded ID, objectId, permission key, or magic value
- Import from a path containing `DEPRECATED` (check whether a non-deprecated equivalent exists)
- Enum or type defined locally that may already exist in a library package
- Any decision a team developer could reasonably make differently

**`// [lesson: "title"]`** — only when a developer without that lesson would plausibly write this differently.

MODIFY line: write the change; marker only if an enforce lesson directly applies.

---

## 4. Enforce check

Using enforce titles from 2A. Fix violations immediately.
```
Enforce check:
  "[title]" — clean | fixed at [description]
```

---

## 5. Verify

```bash
cd [project path] && npx tsc --noEmit 2>&1 | grep "error TS" | head -20
```
Fix every type error. Confirm:
- [ ] Every symbol in written files appears in its import block
- [ ] Every hardcoded ID, deprecated import, invented type has `// [novel: ...]`
- [ ] `tsc --noEmit` exits with zero errors

---

## 6. Audit log

```
## Audit log

### [file]
Template: [path] | NONE
Sections: [in write order]
Lessons applied: "[title]" — [section] | none
Enforce fixes: [list] | none
Novel decisions: [section]: [description] | none
```

If any novel decisions were logged:
```
## Candidates for learn-from-commits

CANDIDATE: [section] in [file]
Pattern: [what was done and why]
Anti-pattern: [what a developer writes without this knowledge]
```
