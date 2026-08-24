# TABLES.md — defineTable, DDL, and the build DAG

Branch reference of the `kit` skill, readable on its own. Paths are relative to the kit
root, `/data/code/fleet` [`/data/ops/lib/agent-context.sh:37`]. **The code is the spec and
this file is a map to it**: every rule carries the file that enforces it, so read the
citation before arguing with the rule, and move the citation in the same commit as the
rule. Nothing here states a fact about an external dependency; those are verified at point
of use against vendored source [`/data/ops/NORTH-STAR.md:9-10`].

## One declaration, derive everything

A payload declaration plus one table definition yield the TS row type, the DDL, the
raw→table projection, and the envelope read columns. These were previously declared three
times — a hand-written interface, a SQL columns clause, and a SQL projection — with nothing
tying them together. **Never restate a shape that is already declared**
[`packages/lake/src/table.ts:1-13,137-154`].

**The link that makes it single-source is a compile error.** A column that references a
payload field is keyed against the payload declaration, so a wrong field name fails the
typecheck instead of becoming a silent NULL column discovered months later
[`packages/lake/src/table.ts:11-13,102-106`].

**Column types are derived, and derivation refuses to guess.** Anything not confidently
mappable is stated explicitly rather than inferred — an override argument exists for
exactly that, and reaching for it is normal, not a smell
[`packages/lake/src/table.ts:28-34,104-106`].

The three escape hatches are ordered by how much they give up, and you should use the
first one that works: a flat payload field (type-checked and type-derived), a nested JSON
path (type asserted by you), and a raw expression over the deduped envelope row (nothing
checked). Meta columns and media columns are helpers rather than hand-written expressions so
that all tables spell them identically [`packages/lake/src/table.ts:104-118,183-208`].

**Do not cite a directory as "where shapes live."** The retired merged skill made exactly
that claim and named a path that does not exist. The mechanism is the rule; the location is
not [`HOUSE-RULES-EXTRACTED.md:120-128`].

## Reading raw

- **The envelope read clause is enumerated in exactly one place**, explicitly, because a
  sampler would otherwise infer per-file shapes and disagree across partitions. It replaced
  a prologue that had been pasted verbatim into 19 build files
  [`packages/lake/src/table.ts:156-163`].
- **Dedupe happens at read time, and the last observation wins** — ordered by ingest
  instant, partitioned by the declared identity. Raw is append-only, so the same fact can
  legitimately appear twice; this is the projection that resolves it. The identity defaults
  to `dedupe_key`, but a stream that folds a content hash into its key must declare the
  stable field instead, or every revision survives as its own row
  [`packages/lake/src/table.ts:170-193`, `packages/lake/src/table.ts:132-136`].
- A table declares which raw stream it projects and which catalog it lives in. Both are part
  of the definition, not of the call site [`packages/lake/src/table.ts:122-134`].

## Catalog behaviour

- **Tables exist with their schema before any data arrives.** That dissolves the
  empty-glob and view-binding failure class the legacy layout worked around three separate
  ways. **An empty table is valid** and every view over it still answers
  [`packages/lake/src/ducklake.ts:1-6,60-61`].
- **The one remaining place the empty-glob problem exists is the read side of a rebuild**,
  and it is handled once, in typed code — never again in a shell script, an ingester, or a
  verify helper [`packages/lake/src/ducklake.ts:8-10`].
- **A rebuild is delete-plus-insert in one transaction**, so a build that dies mid-way
  leaves the previous snapshot readable. The scheme it replaced cleared the file first and
  died second [`packages/lake/src/ducklake.ts:90-99`].
- **A best-effort rollback must not mask the failure that caused it.** It logs a warning and
  lets the original failure through [`packages/lake/src/ducklake.ts:75-88`].
- **The catalog extension version is pinned and asserted, not assumed** — there is a check
  that reads the loaded version back and compares
  [`packages/lake/src/ducklake.ts:27-28,51-58`].

## The build DAG

- **Dependencies are declared per step, never encoded in a filename.** The numbered-file
  scheme collided — three files at the same number — and ordering within a collision was
  decided by argument order in a shell function nobody remembered to update
  [`packages/harness/src/build.ts:1-4,14-19`].
- **Never fail fast.** A failed step marks its dependents skipped, and every independent
  branch still runs: one broken source must not stop the others. The run then aggregates to
  the worst exit, with the failures **named** [`packages/harness/src/build.ts:6-10,21-26`].
- **The sort fails loudly on duplicate ids, unknown deps, or cycles** rather than picking an
  order [`packages/harness/src/build.ts:28-29`].
- Step ids are stable identifiers: they appear in dependency lists and in the single-step
  selector, so renaming one is a rename across callers, in one commit
  [`packages/harness/src/build.ts:15-17`].

## Changing a shape

There is no backward compatibility here and no migration step. Reshape the declaration, fix
every consumer in the same commit, and rebuild — structured and curated tiers are
regenerable by declaration and are not backed up [`/data/ops/NORTH-STAR.md:76-85`,
`CLAUDE.md:40-41`]. The DDL is create-if-absent, so a changed shape needs the table dropped
or rebuilt deliberately; it will not migrate itself
[`packages/lake/src/table.ts:144-145,225-228`].
