# ERRORS.md — taxonomy, exit codes, and the error-masking gate

Branch reference of the `kit` skill, readable on its own. Paths are relative to the kit
root, `/data/code/fleet` [`/data/ops/lib/agent-context.sh:37`]. **The code is the spec and
this file is a map to it**: every rule carries the file that enforces it, so read the
citation before arguing with the rule, and move the citation in the same commit as the
rule. **A gate outranks any prose description of it, including this one** — the previous
prose copy of the gate below named two combinators that do not exist at the pin
[`CLAUDE.md:33-39`]. Nothing here states a fact about an external dependency; those are
verified at point of use against vendored source [`/data/ops/NORTH-STAR.md:9-10`].

The corollary that decides every argument in this file: **crashes are fine, silence is
not.** What costs evenings is not a service that dies, it is the pipeline that swallows an
exception for four months and quietly drops 3% of the data
[`/data/ops/NORTH-STAR.md:22-26`].

## Three fates, decided by type

The taxonomy is four classes and three outcomes [`packages/core/src/errors.ts:1-12`]:

- **A config error is the user's to fix.** Printed as the message alone with no stack —
  the message names the file and the key, so it _is_ the diagnosis, and a stack pointing
  into the kit says nothing about the JSON that needs editing. Exit 2, and never
  fast-retried, because waiting does not fix a bad config file
  [`packages/core/src/errors.ts:3-4,15-17`, `packages/harness/src/run.ts:150-155`].
- **A skip means nothing was configured.** Not a failure: exit 0, but the ledger records
  `skipped`, so a run that did no work does not advance `last_success`. A desktop with no
  calendars configured is not broken [`packages/core/src/errors.ts:5-7,19-21`,
  `packages/harness/src/source.ts:25-32`].
- **Everything else is a real failure.** Typed at the boundary that produced it, keeping
  its cause, exit 1. Local I/O gets one class, an external system misbehaving gets
  another, and both carry the underlying defect rather than a string
  [`packages/core/src/errors.ts:8-9,23-35`].

Choose the class by _who has to act_, not by what threw. A missing user config file is a
config error; a missing directory we were supposed to create is I/O.

## Exit codes

**0 ok or skipped, 2 config error, 1 everything else.** The literal values are stated here
and the duplication is deliberate: three integers are the vocabulary every rule above
uses, and a reader who must open a file to learn what the health responder will see cannot
follow the taxonomy at all. The cost is accepted because there is exactly one place to
check — the mapping is computed in one function [`packages/harness/src/run.ts:39-40`] from
the one numeric constant [`packages/harness/src/ledger.ts:68`], and the inverse
(classifying a subprocess by its exit code alone, when it died before reporting) reads
that same constant [`packages/harness/src/ledger.ts:71-75`]. Changing the mapping means
changing that function, that constant, `CLAUDE.md:60`, and this section in one commit.

**Exactly one place collapses a failure to an exit code**: the harness runner, which is
also the one path the gate exempts. Everywhere else, failures stay in the typed error
channel [`packages/core/src/errors.ts:11-12`, `packages/harness/src/run.ts:1-3`,
`eslint.config.js:50-54`].

What that one place does with each fate, in order: skip → warn line, `skipped`, exit 0;
config error → the message alone on the error path, `config_error`, exit 2; any other
typed failure → one-line summary for the ledger plus the full cause on stderr, `failed`;
a defect or an interrupt, where there is no typed failure to name → squashed to a message,
also `failed` [`packages/harness/src/run.ts:141-170`].

**An exit code is the fallback channel, not the reporting channel.** It cannot express
`skipped`, cannot carry counters, and cannot name the config file at fault, so the runner
writes its own verdict to a file the parent named; the parent falls back to the exit code
only for a source that died before writing one
[`packages/harness/src/run.ts:49-62`, `packages/harness/src/collect.ts:81-97`].

**The process exits after the runtime tears down, never from inside the program.**
Telemetry flushes in its finalizer; an exit from inside the effect would race it and lose
the run's last spans [`packages/harness/src/run.ts:9-11,178-196`].

## The gate

**The gate is the spec, not this section.** `tooling/lint/erasers.json` classifies every
enumerated error-channel combinator as eraser, tag-destroyer, or handler, with a
justification per entry; the lint selectors are generated from that file; an unclassified
name fails the build before lint even runs [`tooling/lint/erasers.json:11-15`,
`eslint.config.js:12-23`, `package.json:9,13`]. **Do not restate the banned set in prose
anywhere** — that is precisely how it went stale last time.

- **A tag-destroyer is banned on contract grounds, not on silence grounds.** It preserves
  the failure but destroys its tag, so the runner can no longer map it to the right exit
  code; a config error reported as a crash costs the same evening as a swallowed one
  [`tooling/lint/erasers.json:9,13`].
- **Typed recovery is always allowed.** Selecting _which_ failures you handle — by tag, by
  predicate, by filter — is a handler, not an eraser, and so is anything that preserves the
  failure somewhere observable [`tooling/lint/erasers.json:14`, `eslint.config.js:7-9`].
- **Passing the gate is not proof a failure survives.** The enumeration is prefix-based and
  prefixes miss semantics. The file says so itself and names a known uncovered case: an
  unjoined forked fibre's failure is silent and no prefix reaches it
  [`tooling/lint/erasers.json:17`].
- **Restructure the code rather than weaken the gate.** It exists to make swallowed errors
  inexpressible, and no exception is negotiated in review
  [`eslint.config.js:1-3`, `CLAUDE.md:38-39`].

**Raw exceptions exist in exactly one kind of file**: the interop shim directories the gate
exempts, where host APIs are lifted into typed failures. That is the only place `try` and
`catch` are legal, and everything else still applies there
[`eslint.config.js:40-49`, `packages/core/src/boundary/fs.ts:1-2,18-27`].

## When a failure genuinely must not fail the run

Three cases in the tree qualify, and none of them erases anything. Each catches **one
named tag** and reports:

- The verdict file cannot be written — a report we could not write must not turn a good run
  bad [`packages/harness/src/run.ts:59-61`].
- The ledger cannot be written — logged loudly, but the run's own exit code still stands
  [`packages/harness/src/collect.ts:116-120`].
- A rollback fails after a failed statement — logged as a warning, deliberately not allowed
  to mask the failure that caused it [`packages/lake/src/ducklake.ts:75-88`].

The pattern to copy when two different things mean the same recovery: collapse both routes
into one named condition and catch _that_, rather than reaching for something that
discards which failure happened — which failure happened is the taxonomy
[`packages/lake/src/cursor.ts:40-57`].
