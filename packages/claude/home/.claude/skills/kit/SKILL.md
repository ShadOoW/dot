---
name: kit
description: |
  House rules for the kit and every tree that builds on it: the error taxonomy and
  its exit-code contract, the status.json run ledger, defineTable and schemas as the
  single source of truth, golden-trace capture and replay, the glyph console format,
  lake envelope primitives, one adapter per external boundary, the
  traces-over-metrics-over-logs signal order, the one-collector-door rule for telemetry
  export, and the no-backward-compatibility rule.
  Use when writing or reviewing anything under @kit/core, @kit/telemetry,
  @kit/harness, @kit/trace, or @kit/lake; when adding or
  changing an ingest source, a build step, or a collect run; when touching exit codes,
  error classes, status.json, freshness budgets, span or metric names, counters,
  collector or exporter configuration, envelopes, dedupe keys, cursors, blob storage, raw
  part files, DuckLake tables or DDL, golden traces, replay diffs, or console output; when
  wrapping an external system behind an adapter; when a lint gate rejects an
  error-handling change; and
  before deleting, renaming, or reshaping anything that already has consumers.
---

# kit

House conventions for the shared foundation every fleet pipeline builds from. The
objective function these serve is dependability per unit of attention — one person,
evenings — and the corollary that decides most arguments here is **crashes are fine,
silence is not** [`/data/ops/NORTH-STAR.md:12-34`].

## Source Rule

- Paths below are relative to the kit root, `/data/code/fleet`
  [`/data/ops/lib/agent-context.sh:37`].
- **The code is the spec; this file is a map to it.** Every rule carries the file
  that enforces it. Read the citation before arguing with the rule, and update the
  citation in the same commit as the rule.
- **A gate outranks any prose description of it, including this one.** Prose copies
  of gate contents have already gone stale in this tree — the previous prose copy of
  the error-masking gate named two combinators that do not exist at the pin
  [`CLAUDE.md:33-39`].
- **Nothing in this skill states a fact about an external dependency.** Those are
  verified at point of use against vendored source [`/data/ops/NORTH-STAR.md:9-10`].
  Library-specific naming that is wrong for the current pin lives in
  `ERRATA-effect.md`, not here.

## Branch Chooser

Read only the branch references that match the task.

- Error classes, exit codes, failure classification, or the error-masking gate: read
  `references/ERRORS.md`.
- `status.json`, run status, freshness budgets, counts, or the ops health responder:
  read `references/LEDGER.md`.
- `defineTable`, DuckLake DDL, raw→table projections, row types, or where a shape is
  declared: read `references/TABLES.md`.
- Golden traces, capture, replay, structural diffs, or ignore paths: read
  `references/TRACES.md`.
- Envelopes, dedupe keys, raw part files, cursors, blobs, or account identity: read
  `references/ENVELOPE.md`.
- Console output, glyphs, number and duration formatting, or where structured data
  goes: read `references/CONSOLE.md`.

If a task spans several branches, read all matching files before editing.

## Failure and Exit Codes

- **Three fates, decided by type** [`packages/core/src/errors.ts:1-12`]:
  - a config error is the user's to fix — printed as the message alone with no stack,
    exit 2, never fast-retried, because waiting does not fix a bad config file;
  - a skip means nothing was configured — exit 0, but the ledger records `skipped`,
    so a run that did no work does not advance `last_success`;
  - everything else is a real failure — typed at its boundary, keeps its cause,
    exit 1.
- **Exit codes are stated as literal values in this section, and the duplication is
  deliberate.** Three integers are the vocabulary every sentence above uses; a reader who
  must open a file to learn what the health responder will see cannot follow the taxonomy
  at all. The cost is accepted because there is exactly one place to check: the mapping is
  computed in one function [`packages/harness/src/run.ts:39-40`] from the one numeric
  constant [`packages/harness/src/ledger.ts:68`], and the inverse — classifying a
  subprocess by its exit code alone, when it died before reporting — reads that same
  constant [`packages/harness/src/ledger.ts:71-75`]. Changing the mapping means changing
  that function, that constant, `CLAUDE.md:60`, and these bullets in one commit. Contrast
  the span and metric names below: a long list of arbitrary strings, with no reading cost
  to looking them up, so they are cited and never copied.
- **Failures are typed and surface. Exactly one place collapses a failure to an exit
  code** — the harness runner, which is the one path the gate exempts. Everywhere else
  they stay in the error channel [`packages/core/src/errors.ts:11-12`,
  `packages/harness/src/run.ts:1-3`, `eslint.config.js:50-53`].
- **The gate is the spec, not this paragraph.** `tooling/lint/erasers.json` classifies every
  enumerated error-channel combinator as eraser, tag-destroyer, or handler with a
  justification per entry; the lint selectors are generated from it; an unclassified
  name fails the build [`tooling/lint/erasers.json:11-15`, `eslint.config.js:1-23`,
  `CLAUDE.md:33-39`]. Do not restate the banned set in prose anywhere.
- **A tag-destroyer is banned on contract grounds, not on silence grounds.** It
  preserves the failure but destroys the tag, so the runner can no longer map it to
  the right exit code, and a config error reported as a crash costs the same evening
  as a swallowed one [`tooling/lint/erasers.json:9,13`].
- **Passing the gate is not proof a failure survives.** The enumeration is
  prefix-based and prefixes miss semantics; the file says so itself and names a known
  uncovered case [`tooling/lint/erasers.json:17`].
- **Restructure the code rather than weaken the gate** [`CLAUDE.md:38-39`].
- **Raw exceptions exist in exactly one kind of file**: the interop shim directories
  the gate exempts, where host APIs are lifted into typed failures
  [`eslint.config.js:40-49`, `packages/core/src/boundary/fs.ts:1-2`].
- **The process exits after the runtime tears down, never from inside the program** —
  telemetry flushes in its finalizer, and an exit from inside would race it and lose
  the run's last spans [`packages/harness/src/run.ts:9-11`].

## The status.json Ledger

- **The field set is a contract read by the ops health responder**
  (`/data/ops/lib/status-server.py`). Do not change a field without changing the
  responder in the same commit [`packages/harness/src/ledger.ts:1-5`,
  `CLAUDE.md:50`].
- **Four statuses because they need four different responses**: `ok`, `skipped`
  (normal, excluded from staleness), `config_error` (will not self-heal — alert now,
  never fast-retry), `failed` (transient or unknown — retry sooner)
  [`packages/harness/src/ledger.ts:24-35`].
- **`last_success` advances only on `ok`**; every other status carries the previous
  value forward. It is derived by the writer, never passed in — that is what makes the
  file a freshness signal instead of a record of the last attempt
  [`packages/harness/src/ledger.ts:9-11,54-55,65`].
- **The producer declares its own staleness budget once**, in `fresh_hours`; the
  responder enforces it. Restating a cadence in the ops health check would let the two
  drift [`packages/harness/src/ledger.ts:7-9,42-43`,
  `packages/harness/src/source.ts:33-40`].
- **Zero counts are signal, not noise.** "Ran fine, ingested nothing" is the early
  symptom of a silently broken source, and only the ledger preserves it
  [`packages/harness/src/ledger.ts:52-53`, `packages/telemetry/src/counters.ts:4-6`].
- **A corrupt or half-written previous ledger reads as empty rather than failing.**
  Failing to parse the previous report must not fail the current run
  [`packages/harness/src/ledger.ts:98-102`].
- **Quoting a line out of stderr is a last-resort fallback, never a data path** — it
  exists only for a process that died before it could report its own verdict
  [`packages/harness/src/ledger.ts:13-16,79-82`].

## Schemas Are the Single Source of Truth

- **One declaration, derive everything.** A payload declaration plus one table
  definition yield the row type, the DDL, the raw→table projection, and the envelope
  read columns. Never restate a shape that is already declared
  [`packages/lake/src/table.ts:1-13,137-154`].
- **The link that makes it single-source is a compile error.** A column referencing a
  payload field is checked against the payload declaration, so a wrong field name
  fails the typecheck instead of becoming a silent NULL column discovered months later
  [`packages/lake/src/table.ts:11-13`].
- **Column types are derived, and derivation refuses to guess.** Anything not
  confidently mappable is stated explicitly rather than inferred
  [`packages/lake/src/table.ts:28-34`].
- **Shapes read out of raw are enumerated in exactly one place.** Per-file inference
  would disagree across partitions [`packages/lake/src/table.ts:156-163`].
- Do not cite a directory as "where shapes live". The location claim in the retired
  merged skill was already false; the mechanism is the rule, the path is not.

## Golden Traces

- **Rung 3 of the oracle ladder. We do not write test suites; we stack oracles**:
  types, then supervision, then golden traces, then quarterly sampling
  [`/data/ops/NORTH-STAR.md:49-74`].
- **What rung 3 trades away, chosen with eyes open**: capture freezes bugs along with
  behavior. It answers "is this still doing what it did last week", never "is this
  correct" [`/data/ops/NORTH-STAR.md:72-74`,
  `packages/trace/src/boundary.ts:8-10`].
- **A traced boundary is a pure transformation with schemas on both sides.** Because
  it is pure, replay never touches the network or a mailbox
  [`packages/trace/src/boundary.ts:3-6`].
- **Capture is a tee, off by default**, enabled by a capture-directory environment
  variable, appending one file per boundary [`packages/trace/src/boundary.ts:12-15,44`].
- **The unit of capture and of diff is the encoded on-disk form**, not the in-memory
  shape — that is the contract a regeneration has to honor
  [`packages/trace/src/boundary.ts:13`, `packages/trace/src/diff.ts:1-3`].
- **Sampling drops successes, never failures** [`packages/trace/src/boundary.ts:27-28`].
- **A boundary name is a durable identity.** Renaming it orphans its golden traces,
  and replay reports the orphan rather than passing quietly
  [`packages/trace/src/boundary.ts:21-22`, `packages/trace/src/replay.ts:18-19`].
- **Run stamps and other per-run values are excluded by declared ignore paths**, not
  by loosening the diff [`packages/trace/src/boundary.ts:25-26`].
- **Registration happens at module load** — import the modules that define your
  boundaries before replaying, or replay finds nothing and says so
  [`packages/trace/src/replay.ts:50-54`].

## Lake Envelope Primitives

- **Envelope v1 is a wire contract with part files already on disk.** The wrapper is
  normalized; the payload is the source record verbatim and lossless
  [`packages/lake/src/envelope.ts:1-4`, `CLAUDE.md:58`].
- **`dedupe_key` is the identity readers dedupe on** — stable, and shaped
  `<domain>:<entity>:…` [`packages/lake/src/envelope.ts:25-26`].
- **Raw is append-only.** Each run writes a uniquely named part file into its
  partition; prior runs' data is never touched, and there is one part naming scheme
  [`packages/lake/src/raw-writer.ts:1-10`].
- **Idempotence by re-doing work, never by failing.** Losing a cursor causes at worst
  a redundant re-append, so a corrupt or missing cursor reads as the fallback value
  [`packages/lake/src/cursor.ts:1-5`, `packages/lake/src/raw-writer.ts:6-7`].
- **Identity, grouping, and presentation are three separate things, and only identity
  is durable.** Only identity is stamped into envelopes and cursor filenames; labels
  and tags are config-only and changing them costs a rebuild, not a fork
  [`packages/lake/src/account.ts:1-13`, `packages/lake/src/cursor.ts:7-8`].
- **Blobs are content-addressed and immutable**: one physical copy per distinct file,
  referenced by hash, read-only bits on disk, never renamed
  [`packages/lake/src/blob.ts:1-5`].
- **An identity never appears in a lake filename.** It belongs in the payload and the
  dedupe key, where it is queryable, not in directory listings, where it leaks
  [`packages/lake/src/raw-writer.ts:10-12`].
- **Every write is tmp-then-rename**, so a crash never leaves a half-written file
  where a reader can see it [`packages/core/src/boundary/fs.ts:3-4`,
  `packages/lake/src/blob.ts:3-5`].

## One Adapter Per External Boundary

- **The ceiling is external boundaries, not code.** What consumes evenings is tokens
  expiring, protocols changing, markup shifting. Every external system sits behind
  exactly one adapter with a schema and a loud failure, so a boundary break is a
  twenty-minute fix instead of an investigation
  [`/data/ops/NORTH-STAR.md:30-34`].
- **Count integrations, not services. That number is the budget**
  [`/data/ops/NORTH-STAR.md:33-34`].
- **"Boundary" means three different things in this tree.** Keep them apart:
  1. an **external-system adapter** — one per integration, the rule above
     [`/data/ops/NORTH-STAR.md:30-34`];
  2. an **interop shim directory** — the only place raw host exceptions exist, and the
     only place the gate permits `try`/`catch`
     [`eslint.config.js:40-49`, `packages/core/src/boundary/fs.ts:1-2`];
  3. a **traced boundary** — a pure transformation with schemas on both sides, the
     unit golden traces capture [`packages/trace/src/boundary.ts:3-6`].
- **Uniformity is an attention multiplier**: twenty services with one shape cost far
  less than twenty with twenty shapes — one runbook, one dashboard, one vocabulary of
  failure. That is why the shared kit exists and why its conventions are mandatory
  [`/data/ops/NORTH-STAR.md:27-29`].
- **Each source is its own file and its own process**, spawned one at a time, so one
  crash cannot take the others down [`packages/harness/src/source.ts:10-13`].

## Signals: Traces > Metrics > Logs

- **Traces first.** A span tree per run is the primary debugging surface; at fleet
  scale you stop reading code and start reading traces
  [`/data/ops/NORTH-STAR.md:87-90`].
- **Metrics second** — counters and freshness, the alert substrate
  [`/data/ops/NORTH-STAR.md:90-91`].
- **Logs third** — human-readable lines for watching a run live, shipped but rarely
  queried [`/data/ops/NORTH-STAR.md:91-92`].
- **Never encode data in log text that then needs parsing back out.** That inversion
  is the anti-pattern this stack exists to kill
  [`/data/ops/NORTH-STAR.md:92-94`].
- **Span and metric names are contracts read by the ops dashboards, and the list lives
  in exactly one place** — the "Contracts that must not drift" section of
  `CLAUDE.md`. Do not copy it here or anywhere else. A source is an attribute, never
  part of a name [`CLAUDE.md:56-64`].
- **One count call feeds both sinks**: the metric for alerting and the accumulated
  record the harness drains into the ledger
  [`packages/telemetry/src/counters.ts:1-6`].

## Telemetry Export

- **A producer carries zero collector configuration in code.** The endpoint is read once,
  from one environment variable, in the one telemetry layer every pipeline provides. No
  module builds an exporter and no module names a destination
  [`packages/telemetry/src/layer.ts:1-9,31-38`].
- **One door for the whole fleet, and it is not declared here.** The collector address is
  an ops concern owned by the observability tree, so changing collector or protocol is
  invisible to every producer. That invisibility is what makes the observability kill
  criterion survivable: the fallback shape can be swapped without touching a pipeline
  [`/data/ops/NORTH-STAR.md:113-114`].
- **No endpoint set is a supported mode, not a degraded one.** Unset means console only —
  what a laptop run and every test gets. Nothing else in the tree branches on whether
  telemetry is configured [`packages/telemetry/src/layer.ts:4-7,38`].
- **An unreachable collector must never fail a run.** The export layer has no error
  channel; export failures surface as log noise. A run that ingested correctly and could
  not report is a successful run with a telemetry problem, and inverting that hands the
  collector a veto over the data [`packages/telemetry/src/layer.ts:8-9`].
- **Ownership**: every clause here is about our collector topology, with no dependency
  content. The seam call is recorded in [`HOUSE-RULES-EXTRACTED.md:88-96`].

## Console Output

- **One console voice for the whole fleet.** Humans read a two-space gutter and the
  `✓ ✗ · !` glyphs, with `▸` for section headers. It is one formatter so that every
  tool in the fleet reads the same [`packages/telemetry/src/glyphs.ts:1-4,20-24`,
  `CLAUDE.md:49`].
- **`NO_COLOR` is honored** [`packages/telemetry/src/glyphs.ts:1,6-7`].
- **The formatters are pure string builders; nothing in them writes anywhere.**
  Deciding where a line goes is the caller's job
  [`packages/telemetry/src/glyphs.ts:2`].
- **Numbers go through the shared formatters** — thousands separators, byte units,
  coarse durations. Six-figure counts are unreadable without separators, and precision
  past the second unit is noise when the number is an estimate
  [`packages/telemetry/src/glyphs.ts:33-59`].
- **Structured data goes to the telemetry pipeline, never to stdout for something to
  parse back.** See the signal rule above [`/data/ops/NORTH-STAR.md:92-94`].

## No Backward Compatibility, Ever

- **Breaking changes always.** Rename or reshape, and fix every consumer in the same
  commit. Not in code, not in config, not in docs — no shims, no aliases, no
  deprecated paths, no compatibility notes
  [`/data/ops/NORTH-STAR.md:84-85`, `CLAUDE.md:40-41`].
- **What makes that safe is regeneration over migration.** State that can be rebuilt
  from sources is never backed up and never migrated. When a bump breaks a module, the
  default move is to delete the implementation and rebuild it against the schemas and
  the golden traces, not to migrate it line by line
  [`/data/ops/NORTH-STAR.md:76-85`].
- **The registry of what is precious is exactly the set of `backup.toml` files.** If
  something is not in one, it is regenerable by declaration and may be deleted
  [`/data/ops/NORTH-STAR.md:78-80`].
- **A hand-maintained inventory is a second source of truth**, and it misleads an
  agent worse than a human because the agent cannot smell that it is stale. Delete it
  and cite the generator [`/data/ops/NORTH-STAR.md:36-47`].

## Checks

`bun` is on PATH here [verified: `bun --version` → 1.3.14, 2026-08-08]. The ops verbs
below are `/data/ops/bin/ops` subcommands.

- **`bun run check` in the kit must pass before any commit** — typecheck, gate
  enumeration, lint, walker probe, tests [`CLAUDE.md:42`, `package.json`].
- **`ops check` gates the materialized agent-context layer** rather than trusting it.
- **A section of a check that prints nothing is evidence of nothing on its own.** It
  is meaningful only because its failure has been observed; if you add a gate, add the
  fixture that makes it fail on demand.

## Provenance

- Every rule above is cited to a file in this tree, to `/data/ops/NORTH-STAR.md`, or
  to `/data/ops/lib`. Nothing is sourced only from the retired merged skill's appended
  section, whose text is unversioned and partly audited false; it is preserved as
  evidence in `HOUSE-RULES-EXTRACTED.md` and is not guidance.
- One clause of that section was dropped rather than relocated: its claim about the
  directory holding payload and table shapes names a path that does not exist.
- The Telemetry Export section's ownership call comes from task 1's seam analysis
  [`HOUSE-RULES-EXTRACTED.md:88-96`], not from the appended section that analysis
  examined; its content is cited to live code. Three clauses of the original were dropped
  rather than relocated: a collector binary name and its address, which are ops topology
  belonging to the observability tree, and a span-name pattern, which is in `CLAUDE.md`.
- No rule here states an API name, a module path, or a version fact for any external
  dependency. If a rule cannot be stated that way it belongs in `tooling/lint/erasers.json`,
  in `ERRATA-effect.md`, or nowhere.
