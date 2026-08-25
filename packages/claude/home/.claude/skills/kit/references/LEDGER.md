# LEDGER.md — status.json, freshness, and the ops health contract

Branch reference of the `kit` skill, readable on its own. Paths are relative to the kit
root, `/data/code/fleet` [`/data/ops/lib/agent-context.sh:37`]. **The code is the spec and
this file is a map to it**: every rule carries the file that enforces it, so read the
citation before arguing with the rule, and move the citation in the same commit as the
rule. Nothing here states a fact about an external dependency; those are verified at point
of use against vendored source [`/data/ops/NORTH-STAR.md:9-10`].

The ledger exists because **crashes are fine, silence is not**: a pipeline that runs
cleanly and ingests nothing is the failure mode worth engineering against, and this file is
the only artifact that preserves it [`/data/ops/NORTH-STAR.md:22-26`].

## The contract

`status.json` is written by the collect orchestrator and read by the ops health responder.
As of 2026-08-25 that responder has **two** live implementations, because the retirement of
the Python one is half-applied: `/data/code/fleet/apps/ops-status` serves the lake's ledger
on the desktop, and `/data/ops/lib/status-server.py` still serves `ops/backup` on barzakh
until that host cuts over. **The field set is a cross-repo contract: do not change a field
without changing every reader in the same commit**
[`packages/harness/src/ledger.ts:1-8`, `apps/ops-status/lib/normalize.ts`,
`/data/ops/lib/status-server.py:87-101`]. Note what the gate does and does not cover: `tooling/probes/ledger-fields/` compares this writer against **both** readers — its `READERS` registry declares `apps/ops-status` as required (absence is exit 2) and `status-server.py` as optional (absence is the planned cutover: a skip with a notice) — and runs three failing fixtures first, so the comparison cannot pass contentlessly.

The fields are declared once, as an interface with a comment per field
[`packages/harness/src/ledger.ts:37-62`]; the "Contracts that must not drift" section of
`CLAUDE.md` carries the one prose copy [`CLAUDE.md:59`]. **Read the interface rather than
looking for a list here** — a third copy is exactly the drift this skill refuses elsewhere
for span and metric names.

## Four statuses, because they need four different responses

`ok` ran and either wrote rows or had nothing new to write. `skipped` means nothing was
configured — a normal state, not a fault, and **excluded from staleness arithmetic
entirely**, because a source that never runs cannot go stale. `config_error` is a mistake
in a config file: it will not self-heal, so it alerts immediately and is never fast-retried.
`failed` is transient or unknown — network, auth, a crash — and is worth retrying sooner
than the normal cadence [`packages/harness/src/ledger.ts:24-35`,
`/data/ops/lib/status-server.py:124-127`].

The distinction is load-bearing at both ends. The orchestrator names the status, not just
the source, when it reports a bad run: one says the file needs editing, the other says try
again, and those are different actions [`packages/harness/src/collect.ts:126-128`].

## Freshness

- **`last_success` advances only on `ok`.** Every other status carries the previous value
  forward. It is derived by the writer and never passed in by a source — that is what makes
  the file a freshness signal instead of a record of the last attempt
  [`packages/harness/src/ledger.ts:64-65,140`, `/data/ops/lib/status-server.py:96-97`].
- **The producer declares its own staleness budget once**, in the source descriptor, and
  the responder enforces whatever the file says. Restating a cadence in the ops health
  check would let the two drift, so the ops side treats its own configured budget as a
  fallback only [`packages/harness/src/source.ts:33-38`,
  `packages/harness/src/ledger.ts:42-43`, `/data/ops/lib/status-server.py:88,98,125`].
- A default budget exists for sources that declare none
  [`packages/harness/src/source.ts:18`]. Do not restate its value; read it.
- **Zero counts are signal, not noise.** "Ran fine, ingested nothing" is the early symptom
  of a silently broken source, and only the ledger preserves it — the metric pipeline
  cannot distinguish it from a source that was not scheduled
  [`packages/harness/src/ledger.ts:52-53`, `packages/telemetry/src/counters.ts:1-6`].

## Writing it

- **The ledger is written before the process decides its own fate.** A non-zero exit is
  what the service reports as failed, and the whole point of the ledger is to say *which*
  source caused it, so it must survive the failing run
  [`packages/harness/src/collect.ts:113-120`].
- **A failed ledger write is logged, not fatal** — the run's own verdict still stands
  [`packages/harness/src/collect.ts:116-120`].
- **The write is atomic.** The responder may read at any moment, and a half-written file
  would read as unknown and alarm spuriously
  [`packages/harness/src/ledger.ts:144-146`, `packages/core/src/boundary/fs.ts:45-58`].
- **Only sources present in this run survive.** A source removed from the registry must
  leave the ledger too, or it sits there permanently stale and reds the dashboard forever
  over something that no longer exists [`packages/harness/src/ledger.ts:122-128`].
- **A corrupt or half-written previous ledger reads as empty rather than failing.** The
  ledger is a report *about* the run; failing to parse the previous report must not fail
  the current one [`packages/harness/src/ledger.ts:98-120`].
- **A source's self-report is trusted on everything except the two things only the parent
  can observe**: the exit code, and the wall-clock duration that includes process startup
  [`packages/harness/src/collect.ts:83-87`].

## Identity

The source name **is** the ledger key and is stable across renames: it is what the
responder, the dashboard, and every historical entry index on. The descriptor name and the
orchestrator's registry entry must agree, and that agreement is contract-tested
[`packages/harness/src/source.ts:21-22`, `packages/harness/src/collect.ts:27-28`]. The
human-facing title is separate and free to change [`packages/harness/src/source.ts:23-24`].

## Quoting stderr is a last resort, never a data path

Scraping a line out of a dead source's stderr exists only for a process that died before it
could report its own verdict — an OOM kill leaves nothing else to quote. A source that
reported never goes through it, and it strips terminal escapes on the way because it is
reading text that was formatted for a human
[`packages/harness/src/ledger.ts:13-16,79-94`, `packages/harness/src/collect.ts:64-66,89-97`].

**Never widen it.** Encoding data in log text that then needs parsing back out is the
inversion this whole stack exists to kill, and this scraper is named in the north star as
the example [`/data/ops/NORTH-STAR.md:92-94`].

## Isolation

Each source is its own file and its own process, spawned one at a time: isolation so one
crash cannot take the others down, and sequential because the heavy sources have peaked
around 12 G RSS on a full backfill. Collapsing several sources into one process's exit code
is how a broken calendar once froze the freshness signal for everything else
[`packages/harness/src/source.ts:10-13`, `packages/harness/src/collect.ts:1-8`].
