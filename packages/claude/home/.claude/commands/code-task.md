# code-task.md

Apply the task in $ARGUMENTS using codebase conventions enforced by agentmemory
and structural templates derived from recent git history.

**Usage:** `/code-task [absolute path to project] [task description]`
Example: `/code-task /Users/you/bruce add a Form for creating a new Quota`

**If no coding task is identifiable in $ARGUMENTS**, stop and respond directly.

**Success criterion:** all files written, enforce check clean, audit log complete.

**Audit markers** — `// [lesson: "title"]` and `// [novel: description]` are kept
in delivered code as the review trail for this workflow.

`{intent: enforce}` = hard rule, never deviate, fix violations on sight.

---

## 0. Preflight

Parse $ARGUMENTS: first token ending in a path separator or starting with `/`
is the project path. Everything after is the task.

```bash
cd [project path]                              # switch to project root
pwd                                            # confirm path is correct
git rev-parse --is-inside-work-tree 2>&1       # must not error
git log --pretty=format: --name-only | grep -v '^$' | head -3   # derive path prefix
curl -s http://localhost:3111/agentmemory/health
```

The path prefix is the leading path segment(s) common to all files in the git log
output (e.g. `code/src`). Use this in all grep patterns in step 3 — do not hardcode.

Augment: run one trivial query to confirm it responds. Stop on failure:
```
STOPPED: [component] unreachable. Fix: [exact command]
```

Output:
```
Project: [absolute path]
Path prefix: [derived, e.g. code/src]
Task: [extracted task description]
```

---

## 1. Load lessons

```
memory_smart_search(query: "[v1] confidence rule evidence", limit: 50)
memory_smart_search(query: "{intent: enforce}", limit: 20)
```

If both return 0, warn and proceed. Hold enforce titles for step 6.

```
Lessons loaded: N total, E enforced
Enforce rules: [titles]
```

---

## 2. Understand the task

**Classify every file:**

| Class | Trigger |
|-------|---------|
| CREATE | New file |
| MODIFY line | ≤5 lines, no new named region introduced |
| MODIFY section | New named region added, OR >20 lines rewritten in one region |

**Paired files:** `index.tsx`, `views.tsx`, and `setup.ts` in the same folder
form a unit — mark them as paired. They share one template source folder.

**Write order:** if one file imports types from another in this task,
write the exporting file first. Otherwise order is free.

**Component type:** name the component being built or modified
(e.g. `TreeSelect`, `CreateForm`, `ListPage`). Used in lesson prefetch queries.

**Domain keyword:** scan the target path right-to-left past the filename.
First segment matching `Form|Select|List|Page|Modal|Picker|View|Field` = domain keyword.
If none found, omit the second git query in step 3.

```
Task breakdown:
  CREATE [path] ([filename]) [↔ paired: paths]
  MODIFY line [path] — [description]
  MODIFY section [path] — [section name]
Component type: [name]
Write order: [explicit if dependency | any order]
Domain keywords: [file → keyword | none]
```

---

## 3. Template selection — parallel sub-agents

Dispatch for every CREATE and MODIFY section. Paired CREATE = one sub-agent.

### Candidate pool (parent thread — substitute real values, never placeholders)

Use the path prefix derived in step 0. Cap each result list at 15 before
passing to sub-agents — do not pass the full git log output.

```bash
git log --pretty=format: --name-only \
  | grep "[PATH_PREFIX].*FILENAME$" \
  | grep -v '^$' | awk '!seen[$0]++' | head -15

# only when domain keyword exists:
git log --pretty=format: --name-only \
  | grep "[PATH_PREFIX].*DOMAIN.*FILENAME$" \
  | grep -v '^$' | awk '!seen[$0]++' | head -10
```

Concatenate, deduplicate, exclude target file(s). Pass merged list to sub-agent.

### Sub-agent prompts (fully self-contained — no cross-references)

**CREATE single file:**
```
You are selecting a structural template. Read structure only — ignore logic.
File: [path]
Task: [one sentence]
Candidates (most recent first): [list — max 15 entries]

1. Cat candidates in order. Stop after 5 or on clear structural match.
2. Extract top-level section names and their order.
3. For any section expected to have more than 3 internal declaration types
   (e.g. callbacks, effects, state), also extract its internal type order.
4. If no structural match: run one Augment query —
   "[component type] redux-form section structure" — and derive the most
   common section order from results. Mark template as NONE.
5. If uncertain about within-section order: omit it — do not guess.

Return ONLY (200 token limit — abbreviate if needed):
Template: [path] | NONE
Reason: [one line]
Sections: 1.[name] 2.[name] 3.[name] ...
Within-section (only for sections with >3 types, if confident):
  [section]: 1.[type] 2.[type] ...
```

**CREATE paired (index.tsx / views.tsx / setup.ts):**
```
You are selecting a structural template. Read structure only — ignore logic.
Files: [list of paired paths] — must come from one source folder.
Task: [one sentence]
Candidates (most recent first): [combined list — max 15 entries]

1. Find a source folder containing the same filenames as the target pair.
2. Cat each file. Check up to 5 folders or stop on clear match.
3. For index.tsx: extract section order and within-section order for callbacks
   and effects (if >3 types). For views.tsx and setup.ts: section order only.
4. If no folder match: run Augment query and derive for each file. Mark NONE.

Return ONLY (250 token limit):
Template folder: [path] | NONE
Reason: [one line]
[filename] sections: 1.[name] 2.[name] ...   (one line per file)
index.tsx [section]: 1.[type] 2.[type] ...   (only if >3 types and confident)
```

**MODIFY section:**
```
You are selecting a structural template. Read structure only — ignore logic.
File: [path]
Section to add: [name]
Task: [one sentence]
Candidates (most recent first): [list — max 15 entries]

1. Cat candidates in order. Check up to 8 files — sections are sparse,
   search more candidates than for CREATE.
2. When target section found: extract internal declaration type order and
   the sections immediately before and after it.

Return ONLY (120 token limit):
Template: [path] | NONE
Reason: [one line]
Internal order: 1.[type] 2.[type] ...
Position: after [section] before [section]
```

### After sub-agents return — STOP HERE

```
Template verdicts:
  [path] → [template | NONE] — [reason]
    Sections: [list]
    [section]: [within-section types]   (if extracted)
  [pair] → folder [path | NONE]
    [filename]: [sections]   (one line per file)
    index.tsx [section]: [types]   (if extracted)
  [MODIFY path] → [template | NONE]
    "[section]": [internal order] after [X] before [Y]

─────────────────────────────────────────
Reply 'go' to proceed. Include overrides in the same message if needed:
  template [filename] = [path]
  order [filename] = ["section 1","section 2","section 3"]
Questions answered here — only changed verdicts shown before re-confirming.
─────────────────────────────────────────
```

---

## 4. Lesson prefetch — parallel sub-agents

Dispatch on 'go'. Use confirmed section lists (post-override). One sub-agent per file.

```
Sub-agent: file [path], component type [from step 2], confirmed sections [list].
For each section:
  memory_smart_search("[section name] [component type] react", limit: 8)
Return per section: [applicable lesson titles] | none
Hard limit: 150 tokens.
```

---

## 5. Write

Process files in confirmed write order.

### CREATE and MODIFY section

One section at a time in confirmed order:

1. Use pre-fetched lessons only — no new agentmemory queries during writing.
   General React and TypeScript knowledge applies freely.
2. Follow section-level order from template. Where within-section order was
   extracted, follow it. Where it was not, apply standard conventions for
   that section type. If genuinely uncertain, use the most conservative
   approach and mark as novel.
3. For MODIFY section: follow the internal order from the template verdict exactly.
4. Audit markers (kept in final output):
   ```typescript
   // [lesson: "title"]
   ```
   Only when a developer without that lesson would plausibly write this differently.
   ```typescript
   // [novel: description]
   ```
   Only when no lesson covers it AND a competent team developer might
   make a different reasonable choice.

### MODIFY line

Write the change. Marker only if an enforce lesson directly applies.

---

## 6. Enforce check

Using enforce titles from step 1 (no re-query). Fix violations immediately.

```
Enforce check:
  "[title]" — clean | fixed at [function name / description]
```

---

## 7. Audit log

```
## Audit log

### [file]
Template: [path] | NONE
Sections: [in write order]
Lessons applied:
  - "[title]" — [section]
Enforce fixes: [list] | none
Novel decisions:
  - [section]: [description]
```

---

## 8. Candidate lessons

Only output if novel decisions were logged. Mandatory if they were.

```
## Candidates for learn-from-commits

CANDIDATE: [section] in [file path]
Pattern: [what was done and why]
Anti-pattern: [what a competent team developer would likely write instead]
```

Pass to the next `learn-from-commits` run as additional context.
