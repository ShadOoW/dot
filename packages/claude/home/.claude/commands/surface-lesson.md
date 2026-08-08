A potential architectural lesson has been observed during this session.
Evaluate whether it is worth adding to AGENTS.md or agentmemory.

$ARGUMENTS contains the observed pattern.

---

## Preflight

Verify the current working directory is inside the bruce monorepo:

```bash
pwd | grep -q "bruce" || echo "ERROR: not in bruce repo — aborting"
```

If the directory does not contain "bruce", stop and tell the user.

---

## Step 1: Check AGENTS.md first

Search AGENTS.md for terms related to the observed pattern before checking
agentmemory. AGENTS.md is the authoritative standards source — if it is
already covered there, stop.

```bash
grep -i "[key terms from the pattern]" /path/to/AGENTS.md
```

If a match is found: output `ALREADY COVERED — [quote the relevant standard
title]` and stop.

---

## Step 2: Check agentmemory

Run two memory_smart_search queries from different angles:

1. Query 1 — the pattern itself:
   memory_smart_search with query="[the observed pattern]" limit=10

2. Query 2 — the domain context:
   memory_smart_search with query="[feature domain] typescript convention" limit=10

If a relevant lesson is already stored: output `ALREADY COVERED — [quote
the lesson]` and stop.

---

## Step 3: Assess confidence

Based on evidence gathered from AGENTS.md, agentmemory, and the current
session:

- **high** — seen 3+ times across the codebase
- **medium** — seen in this session + recalled from 1 prior observation
- **low** — seen once here, no prior evidence

---

## Step 4: Show the proposed standard

Present the full standard in schema format before writing anything:

```
#### [Rule title — 3-5 words]
> [one-line summary of what this rule prevents or enables]

[Full actionable instruction — 2-4 sentences. Written for an AI agent
reading cold. Specific enough that a developer knows exactly what to do.]

❌ Never: [the anti-pattern — concrete code example where possible]
✅ Always: [the correct pattern — concrete code example where possible]

Source: [the-architect-direct | the-architect-pr-comment | observed-pattern]
Scope: [all | frontend | backend]
```

Then state your recommendation:

- **ADD TO AGENTS.md** — architectural principle that always applies
  → Show exactly where: "Insert after `#### [existing standard title]`
  in the `### [Category]` section"
- **ADD TO WATCHLIST** — needs more evidence before becoming a hard rule
  → Format the watchlist entry (see Step 5b)
- **SKIP** — too narrow, too obvious, or confidence is too low

---

## Step 5a: If recommending AGENTS.md

Show the exact insertion point:

```
Category: ### [Naming | Setup | Regions | Architecture | State | Queries | Utilities]
Insert after: #### [title of the preceding standard in that category]
```

Wait for explicit "apply" before modifying AGENTS.md.

---

## Step 5b: If recommending agentmemory watchlist

Format the entry as a learn-from-commits watchlist entry:

```
title: [short title]
pattern: [the observed pattern in one sentence]
suggestedStandard: "When [situation], always/never [action] because [reason]"
confidence: [high | medium | low]
evidenceCount: [N]
source: [observed-pattern | the-architect-pr-comment]
addToAgentsWhen: [condition that would promote this to a hard rule]
```

Wait for explicit "apply" before saving to agentmemory.

---

## Step 6: Apply only on explicit confirmation

Do not modify AGENTS.md or agentmemory until the user says "apply".
If the user says "skip" or "not now", acknowledge and stop.
