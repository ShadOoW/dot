Extract reusable coding lessons from the commit diffs below and save
them to agentmemory for this project.

1. Before extracting anything, check what lessons already exist to avoid duplicates.
   Run both of these:
   a) Bash: curl -s http://localhost:3111/agentmemory/memories
   (full list of every stored memory — primary source of truth)
   b) memory_smart_search with query="coding pattern rule convention" and limit=20
   (catches semantic near-duplicates the curl listing might not surface)
   Read both results. If they conflict, trust (a).

2. Analyze the diffs for reusable patterns:
   - Type design and what is avoided
   - Folder and file placement logic
   - Naming and abstraction conventions
   - Patterns visible across multiple commits (higher confidence)

3. Format each proposed lesson as:
   "When doing X, always/never Y because Z"
   Include a short title (3-5 words) and mark any that overlap with
   existing lessons as DUPLICATE — show them but flag them so I can decide.

4. Present the full numbered list and WAIT for my approval.
   I will say which to keep, edit, merge, or drop.

5. Only after I say "save" call memory_save for each approved lesson
   with type="pattern". Do NOT write markdown files under any circumstances.

Diffs:
$ARGUMENTS
