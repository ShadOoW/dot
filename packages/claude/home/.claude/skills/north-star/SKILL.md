---
name: north-star
description: |
  The private-infrastructure objective function: dependability per unit of attention —
  one person, evenings. Its three corollaries, the oracle ladder (types, then supervision,
  then golden traces, then quarterly sampling), regeneration over migration, signal
  priorities, and the kill criteria for the kit and its Effect bet.
  Use when deciding whether to add, keep, or kill a service, integration, pipeline, or
  dependency in /data/code/fleet, dot, or another private project; when weighing test
  strategy, backups, migration, or compatibility there; and when a rule cites the
  north-star skill and you need the reasoning around it. Does NOT apply to work projects
  under /data/code/work — those have their own objectives and their own AGENTS.md. punk-records
  keeps its own principles in its `decisions/` directory; follow those there.
---

# north-star

This skill is the document. It is rarely edited; when a ruling here changes, change it
here and in the same commit fix whatever cites the section.

## The objective function

**Dependability per unit of attention.** One person, evenings. The output metric is how
many services can run unattended for months before the aggregate maintenance load exceeds
what one person absorbs after work. Not correctness, not elegance, not throughput — those
are inputs at best. Every architectural choice is judged by one question: does this reduce
the number of evenings the system consumes?

Three corollaries that decide arguments before they start:

- **Crashes are fine; silence is not.** A supervisor restarts a crashed service and an
  outside check pages when it stays down. What actually costs evenings is the pipeline that
  swallows an exception for four months and quietly drops 3% of the data. Every design bias
  goes toward loud, restartable failure. Error-masking — `catch {}`, defensive nulls, "just
  log and continue" — is the single most hostile pattern to this system and is banned by
  lint gate, not by discipline.
- **Uniformity is an attention multiplier.** Twenty services with one shape cost far less
  than twenty with twenty shapes: one runbook, one dashboard, one vocabulary of failure.
  That is why a project's conventions are mandatory and why the shared kit exists.
- **The ceiling is external boundaries, not code.** What consumes evenings is tokens
  expiring, protocols changing, markup shifting — failures not caused by our code. Every
  external system sits behind exactly one adapter with a schema and a loud failure, so a
  boundary break is a twenty-minute fix, not an investigation. Count integrations, not
  services; that number is the budget.

## Never keep an inventory by hand

An inventory maintained by hand is a second source of truth that misleads the next agent
worse than it misleads a human, because the agent cannot smell that it is stale. Derive it
from the thing it describes, or do without it.

## The oracle ladder

We do not write test suites. Verification comes from a ladder of oracles, ordered by what
they cost in attention, and every system should state which level it sits on:

1. **Types.** Effect Schema at every boundary; bad data fails loudly at the edge with a
   decode error instead of propagating as `undefined`. The type checker is the
   highest-coverage verifier that costs nothing per run. This is the main argument for
   Effect: it moves error paths and dependency wiring into the checkable domain, and makes
   silently swallowing a failure inexpressible without the linter noticing.
2. **Supervision.** Crash-only design. Services die loudly and restart clean; an outside
   check watches liveness. A service that dies noisily every three weeks beats one that
   never dies and drifts.
3. **Golden traces.** The running system specifies itself: record real inputs and outputs
   at pure boundaries, freeze them, and replay-diff against every change. This is
   deliberately a _regression_ oracle — "is this still doing what it did last week" — not a
   correctness oracle. The cost is one eyeball at first run, then zero. A span tree per
   pipeline run is the operational twin of this idea.
4. **Sampling.** Some failure classes are invisible to types, traces, and golden files —
   semantic drift in entity resolution is the canonical one: well-typed records, clean
   traces, merges quietly getting worse. Budget one manual sample check per quarter on
   anything doing inference over our own data. This is the irreducible human minimum.

**What level 3 trades away, stated plainly:** golden traces freeze bugs along with
behavior. We get stability, not correctness. A bug present at first capture stays until
noticed in the data. Chosen with eyes open.

## Regeneration over migration

State that can be rebuilt from sources is never backed up and never migrated: telemetry,
derived tables, check history. What is precious is exactly what the deployment declares as
backed up; anything not declared there is regenerable and may be deleted. When a dependency
bump breaks a module, the default move is regenerate — delete the implementation and
rebuild it against the schemas and golden traces — not migrate line by line. This is what
makes an aggressive-upgrade policy (pinned-exact versions, no compatibility shims, breaking
changes always) an architectural property instead of a discipline. Corollary: **never write
backward compatibility.** Not in code, not in config, not in docs. Delete the old thing in
the same commit.

## Signal priorities

Traces > metrics > logs. Effect pipelines emit a span tree per run — that is the primary
debugging surface; at fleet scale you stop reading code and start reading traces. Metrics
are second (counters and freshness; the alert substrate). Logs are third — human-readable
glyph lines for watching a run live, shipped but rarely queried. Never encode data in log
text that then needs parsing back out; that inversion (the old `lastErrorLine`
ANSI-scraper) is the anti-pattern this stack exists to kill.

## Kill criteria

Written down while nobody is invested. Any of these fires → keep the trace harness and the
error-masking lint gate (cheap, useful under any architecture), abandon the rest of that
bet:

- A kit-built pipeline needs more than ~2 interventions a month after its first fixing
  round — the architecture isn't buying dependability.
- Effect's type errors consume more evenings than the bugs they prevent.
- An Effect bump becomes a project instead of an evening — regenerate the affected modules
  or leave Effect, and record which in a decision record.
- **The agent-infrastructure layer itself.** Measure per-session auto-loaded context
  tokens, then A/B the kit skill against no skill on three real tasks. If output quality
  does not improve measurably, cut the docs. The ETH Zurich evaluation of repository
  context files (arXiv 2602.11988) found they tend to _reduce_ task success rates while
  adding over 20% inference cost. Our case — a library release no model has seen — is
  plausibly the best case for context, but that is a hypothesis, not a result, and this
  layer is not exempt from its own objective function.
