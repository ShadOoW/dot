# ENVELOPE.md — envelopes, dedupe keys, cursors, blobs, and account identity

Branch reference of the `kit` skill, readable on its own. Paths are relative to the kit
root, `/data/code/fleet` [`/data/ops/lib/agent-context.sh:37`]. **The code is the spec and
this file is a map to it**: every rule carries the file that enforces it, so read the
citation before arguing with the rule, and move the citation in the same commit as the
rule. Nothing here states a fact about an external dependency; those are verified at point
of use against vendored source [`/data/ops/NORTH-STAR.md:9-10`].

Everything in this file is constrained by data already on disk. The no-backward-compatibility
rule applies to code, not to bytes we cannot rewrite: **roughly 5,000 existing part files
were written under these contracts** [`packages/lake/src/raw-writer.ts:1-2`].

## Envelope v1

- **The wrapper is normalized; the payload is the source record verbatim and lossless.**
  Nothing about the source record is cleaned, renamed, or dropped on the way into raw —
  normalization happens later, in the projection to a table
  [`packages/lake/src/envelope.ts:1-4,16-29`].
- **`dedupe_key` is the identity readers dedupe on** — stable, and shaped
  `<domain>:<entity>:…`. It is the only identity guarantee raw offers, and the projection
  layer relies on it entirely [`packages/lake/src/envelope.ts:25-26`].
- The host stamp is taken from the machine but overridable, because a backfill run on one
  machine may legitimately be writing another machine's history. **Known hazard**: the two
  facts are not the same string — `hostname()` is what the kernel calls the box, the stamp
  is whose history the record is. Where they differ, an unset `ENVELOPE_HOST` writes a
  second value for one logical dataset, permanently and silently, since raw is append-only
  and `host` is queryable. The deployment closes it by exporting the variable; the durable
  fix is to make host an explicit argument of the builder, the way the raw writer already
  takes it [`packages/lake/src/envelope.ts:33-51`, `packages/lake/src/raw-writer.ts:61-64`].
- Construction goes through one builder, which stamps the version, the host, and the ingest
  instant. A writer supplies only what it actually knows
  [`packages/lake/src/envelope.ts:56-94`].

**Open finding, do not treat as settled**: the JSON Schema copy of this shape at
`apps/lake-catalog/schemas/envelope.v1.json` describes itself, via the source comment at
`packages/lake/src/envelope.ts:3-4`, as generated from the schema. **It is not.** No
generator exists; the file is hand-maintained and predates the kit. Until that is decided
one way or the other, the envelope shape is declared in two places with nothing tying them
together — edit one and the other does not follow. Recorded with evidence in
`/data/ops/MIGRATION.md`, under "Open, not yet decided".

## Raw is append-only

- **Each run writes a uniquely named part file into its partition; prior runs' data is never
  touched.** There is one part naming scheme, and chunked writers count up within a run
  [`packages/lake/src/raw-writer.ts:4-9,26-36`].
- **An identity never appears in a lake filename.** It belongs in the payload and the dedupe
  key, where it is queryable — not in directory listings, where it leaks. This is not
  hypothetical: a slug was once stamped into 65,801 dedupe keys and also named the cursor
  [`packages/lake/src/raw-writer.ts:8-11`, `packages/lake/src/account.ts:26-27`].
- A verbatim source file is stored as a snapshot rather than pretended to be a record stream,
  and only when it changed [`packages/lake/src/raw-writer.ts:37-52`].

## Idempotence by re-doing work, never by failing

- **Losing a cursor causes at worst a redundant re-append** — readers dedupe — so a corrupt
  or missing cursor reads as the fallback value. Recovery is re-doing work; failing the run
  is never the safer option here [`packages/lake/src/cursor.ts:1-5`,
  `packages/lake/src/raw-writer.ts:6-7`].
- Both failure routes — unparseable JSON and a stale shape that no longer decodes — collapse
  into **one named condition**, and the recovery is a typed catch on that one name. Reaching
  for something that discards *which* failure happened would discard the taxonomy
  [`packages/lake/src/cursor.ts:40-57`].
- Cursor writes are atomic and schema-encoded, so a half-written cursor is not a state the
  next run can observe [`packages/lake/src/cursor.ts:59-68`].
- **Cursor names are keyed by identity, never by a label or a tag** — renaming a label must
  not orphan a cursor [`packages/lake/src/cursor.ts:7-8`].

## Identity, grouping, presentation

**Three separable things, and conflating any two of them is the bug this module exists to
prevent. Only identity is durable** [`packages/lake/src/account.ts:1-13`]:

- **identity** is the account's address, lowercased: permanent, unique, upstream. It is
  stamped into dedupe keys and cursor filenames, so changing it forks the account.
- **grouping** is tags: many per account, config-only, and they identify nothing.
- **presentation** is a label: one per account, config-only, display only.

Tags and labels are read from config at build time and never stamped on an envelope, so
either can be changed whenever, at the cost of a rebuild rather than a fork.

Three observed failures are now structurally impossible rather than merely discouraged: a
slug that identified nothing (four mailboxes shared it), a second name that drifted from the
first (a label that repeated the address it labelled), and a slug that leaked into 65,801
dedupe keys and a cursor filename [`packages/lake/src/account.ts:15-33`].

Lowercasing on the way in is what stops one mailbox becoming two accounts
[`packages/lake/src/account.ts:29-33`]. The validators are deliberately narrow: the key
validator is email-shaped because every source with accounts today keys on a mailbox
address. **A source that keys on something else needs its own validator, not a widening of
this one** [`packages/lake/src/account.ts:35-37`]. Tags are narrower than they need to be on
purpose, leaving room for a namespaced convention later without a migration
[`packages/lake/src/account.ts:65-69`].

## Blobs

**Content-addressed and immutable**: one physical copy per distinct file, referenced by hash
from envelopes and tables, never duplicated and never renamed. The bits on disk are
read-only, which is what has kept 83k of them honest, and storing is idempotent by
construction — an existing address is a no-op, not an overwrite
[`packages/lake/src/blob.ts:1-5,24-35`].

## Every write is tmp-then-rename

A crash must never leave a half-written file where a reader can see it. There is one atomic
write for mutable artifacts and one for immutable ones, which sets the read-only bits before
the rename rather than after — the window between the two is exactly where a partial blob
would become visible at its content address
[`packages/core/src/boundary/fs.ts:3-4,45-58,60-74`].
