# CONSOLE.md — the glyph console, formatters, progress, and where data goes

Branch reference of the `kit` skill, readable on its own. Paths are relative to the kit
root, `/data/code/fleet` [`/data/ops/lib/agent-context.sh:37`]. **The code is the spec and
this file is a map to it**: every rule carries the file that enforces it, so read the
citation before arguing with the rule, and move the citation in the same commit as the
rule. Nothing here states a fact about an external dependency; those are verified at point
of use against vendored source [`/data/ops/NORTH-STAR.md:9-10`].

The reason a console format is a house rule at all: **uniformity is an attention
multiplier.** Twenty services with one shape cost far less than twenty with twenty shapes —
one runbook, one dashboard, one vocabulary of failure
[`/data/ops/NORTH-STAR.md:27-29`].

## One voice for the whole fleet

Humans read a two-space gutter and the `✓ ✗ · !` glyphs, with `▸` for section headers. It is
one formatter, ported from the lake catalog's console helper and the ops shell logger, so
every tool in the fleet reads the same [`packages/telemetry/src/glyphs.ts:1-4,20-24`,
`CLAUDE.md:49`]. There is also a PASS/FAIL line for acceptance checks, which is the same
voice rather than a second one [`packages/telemetry/src/glyphs.ts:26-31`].

**`NO_COLOR` is honored**, decided once at module load rather than per call site
[`packages/telemetry/src/glyphs.ts:1,6-7`].

**The formatters are pure string builders; nothing in them writes anywhere.** Deciding where
a line goes is the caller's job, which is what lets the same helpers be used by a logger, by
the harness at run boundaries, and by a test asserting on a string
[`packages/telemetry/src/glyphs.ts:2,20-31`].

## The logger

The glyph logger replaces the default pretty logger, so log output is house-shaped without
each caller formatting anything [`packages/telemetry/src/logger.ts:1-4`,
`packages/telemetry/src/layer.ts:3,29`].

**The level mapping is fixed**: error and fatal go to stderr with the `✗` glyph and, when
there is one, the rendered cause below; warnings get `!`; debug and trace get a dimmed `·`;
anything else gets a plain `·`. Everything but the error path goes to stdout
[`packages/telemetry/src/logger.ts:6-7,15-34`].

**Success has no log level of its own.** The `✓` lines are printed directly by the harness at
run boundaries, because a successful run is a structural event — a section opening and a
verdict closing it — not a message someone chose to log
[`packages/telemetry/src/logger.ts:6-7`, `packages/harness/src/run.ts:114,137`].

## Numbers

**Numbers go through the shared formatters.** Six-figure counts are unreadable without
thousands separators; byte units are chosen by magnitude; durations are coarse — precision
past the second unit is noise when the number it describes is an estimate
[`packages/telemetry/src/glyphs.ts:33-59`].

## Progress

A full backfill is hours inside one loop. Without progress output the command prints its
banner and then nothing until it ends, which is **indistinguishable from a hang** — that is
the failure this exists to prevent, not impatience
[`packages/telemetry/src/progress.ts:1-7`].

Three deliberate choices worth preserving if you touch it:

- Rate and ETA come from **this run's** measured throughput, not a stored average
  [`packages/telemetry/src/progress.ts:5-7`].
- Everything is measured from the first item, not from construction, and relative to the
  counters as they stood then: connecting and listing take seconds during which nothing
  moves, and the counters may be shared across phases — charging either to this walk skews
  the rate by an order of magnitude [`packages/telemetry/src/progress.ts:42-47`].
- The ETA is rounded to a coarse step, because a to-the-second ETA implies a precision the
  estimate does not have [`packages/telemetry/src/progress.ts:17-23`].

## Where structured data goes

**Structured data goes to the telemetry pipeline, never to stdout for something to parse back
out.** That inversion is the anti-pattern this stack exists to kill, and the named example is
the old scraper that read a diagnosis back out of ANSI-coloured stderr
[`/data/ops/NORTH-STAR.md:87-94`, `packages/telemetry/src/logger.ts:1-4`].

The console is third in the signal order — traces first as the primary debugging surface,
metrics second as the alert substrate, logs third: human-readable lines for watching a run
live, shipped but rarely queried. Writing a line for a machine to read is choosing the
weakest of the three [`/data/ops/NORTH-STAR.md:87-92`].

One count call feeds both machine sinks — the metric for alerting and the accumulated record
the harness drains into the ledger — so counting is never a reason to print
[`packages/telemetry/src/counters.ts:1-6`].

## Console-only is a supported mode

With no collector endpoint configured, the glyph console is the whole output, and that is a
valid mode rather than a degraded one: it is what a laptop run and every test gets. A
producer carries **zero** collector configuration in code, and an unreachable collector must
never fail a run [`packages/telemetry/src/layer.ts:1-9`].
