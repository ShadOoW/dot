---
name: egghead
description: |
  How the house's machines are declared and why. /data/config/egghead is one NixOS flake
  holding every machine (punk, the desktop guest, snake, hawk, rescue, installer): one folder per
  machine, a shared module only where two machines share a declaration, imports listed by hand,
  each program beside the module that runs it. The same repository holds the study ladder
  (`.plans/`), the decision records (`decisions/`), the vocabulary (`VOCABULARY.md`) and `./check`
  that explain it.
  Use for anything under /data/config/egghead: before adding, moving or
  changing a machine, module, service, check, secret, test or plan step, and before proposing a
  restructure (organise by feature, adopt Clan, a folder per service, split or join repositories,
  a Kubernetes cluster); and whenever work needs fresh lake data — new rows in raw, bronze, silver
  or the published Parquet files — before waiting for snake's hourly jobs (bronze-load,
  silver-build, jira-ingest…).
---

# egghead

One person runs every machine of the house, in evenings. Every choice here is judged by one
question: does it reduce the evenings the system consumes (`decisions/0028`, dependability per
unit of attention). The layout below follows from that question; each rule says why, so you can
tell a rule from an accident. Do not restructure on taste: a change to any rule here is a ladder
rung with a decision record, and this skill changes in the same change.

## One repository

`/data/config/egghead` (remote `github.com/shadhq/egghead`) holds the flake and every machine,
and the ladder that explains them: `.plans/PLAN.md` and one `study-NN-name.md` per step, `decisions/`
(one rule per file; read `decisions/AGENTS.md`), `VOCABULARY.md` and `./check`. They were a second
repository, ops-next, until step 19a merged its history in at the same paths (2026-10-04). A step is
one commit, and a citation between the code and its step resolves in one tree. `ops-next` appears
only in history: records and old commit messages. Its earlier names are retired: `punk-records` (the folder and
this skill, until step 21b) and `ragnarok` (the GitHub repository, which still redirects; never create a repository
named `ragnarok` under `shadhq`, or the redirect breaks).

## Layout

```
flake.nix          inputs; one module list per machine; packages; checks (19h moves checks out)
hosts/<machine>/   one folder per nixosConfiguration and nothing else: punk, desktop, snake, hawk, rescue, installer
modules/           a declaration two or more machines import
constants/         a value two or more machines read, or one reads about another: one file per value
tests/             VM tests and fixtures, used by checks
bin/               operator tools run against a live machine (bin/hawk, bin/snake, bin/desktop, …)
secrets/<machine>/ one sops file per secret; secrets/default.nix lists them without a key
.plans/            the ladder: PLAN.md, one study-NN-name.md per step, CHECKPOINTS.md, DEFERRED.md
decisions/         one rule per file (decisions/AGENTS.md)
VOCABULARY.md      every name chosen, and the check that chose it
check              ./check: the citations, retirement and vocabulary checks
flake-check        ./flake-check: the Nix gate, what `nix flake check` checks, evaluated in parallel
```

The machines: **punk** is the physical host (ZFS, Incus) and runs no service of its own beyond
what `decisions/0037` allows (reach, data, guests, shares; its closed list is
`hosts/punk/host-list.nix`). **desktop** is the operator's workstation, a privileged Incus
container on punk; no service may depend on it. **snake** is an Incus VM on punk running the
house's services and the lake pipeline. **hawk** is the rented Hetzner server (barzakh's machine
until step 17 reinstalled it as hawk) and runs the public services directly. **rescue** and
**installer** are escape hatches. Global invariant 1: no service runs on the punk host or on the desk.

## The rules, and why

1. **Where a file goes is `decisions/0041`.** One folder per nixosConfiguration under `hosts/`,
   nothing else there; a file only one machine uses in its folder, the program a module runs
   beside it; a declaration two machines run in `modules/`; a value two machines read, or one
   reads about another, in `constants/`; no file reads another machine's folder.
   `checks.machine-folders` is red on a breach. fleet is a flake input only for the apps
   `migration.md` §14.6 names.
2. **A declaration two machines share is one module in `modules/`, never a copy.** Why: copies
   drift silently; a fix to one never reaches the other. Known copies still to remove: the
   offsite backup (`hosts/punk/offsite.nix` and `hosts/hawk/offsite.nix`, 122 lines of code in
   common; step 19d) and the settings every machine shares (Nix, SSH, the `admin` user, locale,
   ZFS boot, the snapshot template; step 19g). Do not add a third copy: extract first.
3. **A module in `modules/` names nothing true of one machine only.** An address, an interface,
   a peer is an option with no default, set in that machine's list in `flake.nix` (step 15's rule,
   `decisions/0010`, one source per fact). A module in `hosts/<machine>/` may hold its own
   machine's place as constants.
4. **The import list names everything a machine runs: `decisions/0042`.** Imports listed by
   hand; importing a module turns it on; no `enable` option; no automatic import of a directory.
5. **Never keep a list of machines, files or units by hand** (`decisions/0029`). Derive it from
   the declaration and make the flake red when they disagree: `checks.host-list`,
   `checks.secret-set`, the backup sets (`nix build .#hawk-backup-set`). Lists still kept by hand,
   to be derived in step 19f: the Storage Box's `authorized_keys` and Prometheus's scrape targets.
6. **One shape across services** (`0028`). A scheduled job is a `Type=oneshot` unit, a timer and a
   status unit that writes through `modules/status-file.nix`; exit codes follow `decisions/0039`;
   state goes in `StateDirectory`; produced records go to the lake (`decisions/0040`); only state
   is backed up (`decisions/0036`). Before writing a service, copy the shape of the nearest
   sibling, not a new one.
7. **Secrets never touch disk in plaintext.** One sops file per secret in `secrets/<machine>/`,
   opened by the machine's own SSH host key, the Mac's key and the recovery key (`.sops.yaml`,
   `RECOVERY.md`).
8. **Addresses are IP literals on purpose** where a resolver would be a dependency (Prometheus:
   punk's alert pushes died with its DNS once). Another machine's address written in many files is a
   known debt: step 19e gives every address one source. Until then, copy the literal its
   siblings use and do not invent a second form.

## Considered and rejected — do not re-propose without the trigger

- **Organising by feature (the dendritic pattern).** (`decisions/0042`) Its lessons are taken (rules 2, 4, and no
  `specialArgs`, step 19h); its mechanism is not, because automatic import hides what a machine
  runs. Trigger to revisit: `modules/` holds more Nix code than `hosts/` (337 against 6,592 on
  2026-10-04), in `.plans/DEFERRED.md`.
- **Clan.** (`decisions/0041`) Its lesson is taken: one side of a multi-machine service derived from the other (step
  19f). Clan itself loses: its secrets system is experimental with no guaranteed migration, it
  would replace the sops design, its library lacks restic-to-append-only and headscale, and it
  changes fast. Step 15 rejected its inventory in small ("a placement table … what a cluster
  would bring, not evidence about whether one is needed").
- **A folder per service.** (`decisions/0041`) Right only for workloads a scheduler places. If a Kubernetes cluster
  is ever justified (ops decision 0052 gates it: a written reason first), machines stay in
  `hosts/` and workloads go one folder per service, rendered from Nix (nixidy); the escape
  hatches (headscale, the WireGuard hub, backups) stay plain systemd units. A CronJob cannot run
  one job after another; the lake pipeline relies on systemd's `After=`.
- **Separate repositories for docs, plans or config.** (`decisions/0041`) Two repositories turned every step into
  two commits joined by a hand-copied hash and left citations uncheckable; step 19a undid that.

## How a change is made

- **The ladder.** Work is a rung in `.plans/PLAN.md`: `/study NN` teaches and designs with the
  operator, `/execute-study-step NN` builds from the step file alone in a fresh session. The
  status ledger and the run order are in PLAN.md; work pushed out has one home,
  `.plans/DEFERRED.md`, each row with its trigger. Read PLAN.md's house rules before building.
- **Names.** Every new name is checked against `VOCABULARY.md`: a standard word in its standard
  sense, never a word already taken (`decisions/0035`). `base`, for example, is taken.
- **Gates.** Both at the root, on the desk: `./flake-check` before every commit: what
  `nix flake check` checks, evaluated on every core (about 40 s against 75 s), printing each
  machine's `drvPath` as `machine <name> <drvPath>`; a change of markdown documents only builds
  `checks.secret-set` alone (gitleaks over every tracked file, `.plans/` included). `./check`
  before a build, before its commit, and again after the commit. Every gate ships with a fixture
  proving it can fail (`decisions/0008`). A refactor is proven by unchanged store paths (step 15
  did this for `hello`): diff two runs' `machine` lines.
- **Deploys** go from the desk: `bin/hawk deploy`, `bin/snake deploy`, `bin/desktop deploy`;
  punk's own switch is the operator's (it needs sudo). Nothing is built on hawk.
- **Run a lake job; never wait for its timer.** Work that needs a fresh run of a snake job
  (bronze-load, silver-build, jira-ingest, …) runs it now, from the desk:
  `ssh admin@punk 'cd /data/config/egghead && bin/snake run bronze-load silver-build'`,
  jobs in pipeline order. An early run does what the scheduled one would, costs seconds, and
  is not an intervention to log; re-running a *failed* job is (`decisions/0033`). `run` itself
  waits while another job runs or a timer is due within a minute, because the timers are
  spread so no two jobs share snake's memory; if it gives up after 10 minutes it names the job in
  the way and when to try again. Never `ssh root@snake … systemctl start`: it skips that check.
- **Commits.** A step is one commit: `step NN: name — <what is now true>`; outside the ladder
  `<machine or area>: <what is now true>`; planning `plan: …`. In prose a step is `step NN` here
  and `egghead step NN` in another repository. Read the `commit` skill.
- **Citations** name a heading or a symbol, never a line number, and resolve in the tree they are written in
  (`decisions/0024`). `./check` is red on a path into this tree that does not resolve, outside the step files
  and `.plans/CHECKPOINTS.md`: a move or delete fixes every citation in the same commit, a gone file is named
  without its path, another repository's path is written absolute.

## Planned changes to this layout (rungs 19d–19h)

Do not anticipate them in unrelated work, and do not contradict them. When one lands, update
this skill in the same change.

| Rung | Changes |
|---|---|
| 19d shared-module | `modules/offsite.nix` for punk and hawk |
| 19e addresses | one file for every machine's addresses |
| 19f derived-peers | the Storage Box's keys and Prometheus's targets derived from the machines |
| 19g machine-module | one module for what every machine shares |
| 19h flake-outputs | each check in its own file; no `specialArgs` |

## Sources of the comparison (read 2026-10-04)

- The dendritic pattern: https://github.com/mightyiam/dendritic
- Clan inventory and 26.05 release notes: https://clan.lol/docs/26.05/guides/inventory/intro-to-inventory,
  https://clan.lol/docs/26.05/releases/26-05
- Flux, repository structure: https://fluxcd.io/flux/guides/repository-structure
- Argo CD, best practices: https://argo-cd.readthedocs.io/en/stable/user-guide/best_practices
- Nygard, decision records in the project repository:
  https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions
- nixidy, Kubernetes manifests from Nix: https://github.com/arnarg/nixidy
- ryan4yin/nix-config, vars/: https://github.com/ryan4yin/nix-config/tree/main/vars
- The full comparison: `.plans/study-19c-repo-layout.md`, Findings.
