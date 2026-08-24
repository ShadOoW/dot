# TRACES.md — golden-trace capture, replay, and diffs

Branch reference of the `kit` skill, readable on its own. Paths are relative to the kit
root, `/data/code/fleet` [`/data/ops/lib/agent-context.sh:37`]. **The code is the spec and
this file is a map to it**: every rule carries the file that enforces it, so read the
citation before arguing with the rule, and move the citation in the same commit as the
rule. Nothing here states a fact about an external dependency; those are verified at point
of use against vendored source [`/data/ops/NORTH-STAR.md:9-10`].

## Where this sits

**We do not write test suites; we stack oracles**, ordered by what they cost in attention,
and every system states which rung it sits on: types at the edges, then supervision
(crash-only, watched from outside), then golden traces, then one manual sampling check per
quarter on anything doing inference over our own data. Golden traces are **rung 3**
[`/data/ops/NORTH-STAR.md:49-74`].

**What rung 3 trades away, chosen with eyes open**: capture freezes bugs along with
behaviour. It answers "is this still doing what it did last week" and never "is this
correct". A bug present at first capture stays until someone notices it in the data — so the
one eyeball at first capture is the whole verification, and it is not optional
[`/data/ops/NORTH-STAR.md:72-74`, `packages/trace/src/boundary.ts:8-10`].

## What a boundary is

**A traced boundary is a pure transformation with schemas on both sides** — source record to
envelope, bytes to parsed document, inputs to fingerprint. Because it is pure, replay never
touches the network or a mailbox: capture happens at the pure edge and the frozen file
becomes the regression suite [`packages/trace/src/boundary.ts:3-6,20-29`].

If a candidate boundary needs the network to replay, it is not a boundary yet. Split the
fetch from the transformation and trace the transformation.

**"Boundary" means three different things in this tree.** Keep them apart:

1. an **external-system adapter** — one per integration, the unit the attention budget
   counts [`/data/ops/NORTH-STAR.md:30-34`];
2. an **interop shim directory** — the only place raw host exceptions exist, and the only
   place the lint gate permits `try`/`catch`
   [`eslint.config.js:40-49`, `packages/core/src/boundary/fs.ts:1-2`];
3. a **traced boundary** — this file [`packages/trace/src/boundary.ts:3-6`].

## Capture

- **Capture is a tee, and it is off by default**, enabled by a capture-directory environment
  variable and appending one file per boundary. With the variable unset, the instrumented
  function is the function [`packages/trace/src/boundary.ts:12-15,44,66-82`].
- **The unit of capture is the encoded on-disk form, not the in-memory shape.** That is the
  contract a regeneration has to honour, and it is why capture runs the schema encoder on
  both input and output rather than serialising whatever objects happened to be in flight
  [`packages/trace/src/boundary.ts:13,73-77`, `packages/trace/src/diff.ts:1-3`].
- **Sampling drops successes, never failures.** A sample keeps every nth call, so a full
  backfill does not become a 65k-line trace file, but a parse-error case is always worth
  keeping [`packages/trace/src/boundary.ts:27-28`].
- **A boundary name is a durable identity.** Renaming it orphans its golden traces. This is
  not silent: replay reports the orphan rather than passing quietly, because a trace file
  with no registered boundary means a rename or a deletion and both need a human decision
  [`packages/trace/src/boundary.ts:21-22`, `packages/trace/src/replay.ts:14-20`].

## Replay and diff

- **Registration happens at module load.** Import the modules that define your boundaries
  before replaying, or replay finds nothing — and finding nothing looks exactly like passing
  [`packages/trace/src/boundary.ts:95`, `packages/trace/src/replay.ts:50-54`].
- The diff is structural over the encoded form and reports a path per mismatch, so a failure
  names the field rather than dumping two documents
  [`packages/trace/src/diff.ts:20-50`].
- **Per-run values are excluded by declared ignore paths, never by loosening the diff.**
  Run stamps and ingest instants are declared on the boundary that produces them; the
  matcher covers a subtree and treats array elements without their index, so an ignore is
  written once and not per position
  [`packages/trace/src/boundary.ts:25-26`, `packages/trace/src/diff.ts:14-18`].
- An ignore path is an admission that a field is not part of the contract. If you find
  yourself ignoring a field that carries meaning, the boundary is impure — fix the boundary.

## Adding one

Wrap a pure function, give it a stable name, give it schemas on both sides, declare the
ignore paths for anything per-run, and set a sample only if volume demands it. Then run the
real pipeline once with capture enabled, **read the captured file** — that is the one
eyeball rung 3 costs — and commit it. From then on the check is free
[`packages/trace/src/boundary.ts:46-53`, `/data/ops/NORTH-STAR.md:62-66`].

The operational twin of the same idea is one span per pipeline run: traces are the primary
debugging surface at fleet scale, and golden files are the same recording made durable
[`/data/ops/NORTH-STAR.md:65-66`].
