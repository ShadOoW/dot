---
name: egghead
description: |
  How the house's machines are declared and why. `fleet/` in /data/code/logos holds every machine
  of one NixOS flake (punk, the desktop guest, snake, shark, hawk, rescue, installer), the flake
  itself at logos' root: one folder per machine, a shared module only where two machines share a
  declaration, imports listed by hand, each program beside the module that runs it. The same
  repository holds the plans in flight (`.plans/<plan>/`, the plans skill), the decision records
  (`docs/decisions/`), the vocabulary (`docs/VOCABULARY.md`) and `fleet/check` that explain it.
  Use for anything under /data/code/logos/fleet: before adding, moving or
  changing a machine, module, service, check, secret, test or plan step, and before proposing a
  restructure (organise by feature, adopt Clan, a folder per service, split or join repositories,
  a Kubernetes cluster); and whenever work needs fresh lake data — new rows in raw, bronze, silver
  or the published Parquet files — before waiting for snake's hourly jobs (bronze-load,
  silver-build, jira-ingest…).
---

# egghead

One person runs every machine of the house, in evenings. Every choice here is judged by one
question: does it reduce the evenings the system consumes (`docs/decisions/0028`, dependability per
unit of attention). The layout below follows from that question; each rule says why, so you can
tell a rule from an accident. Do not restructure on taste: a change to any rule here is a plan's
step with a decision record, and this skill changes in the same change.

## One repository

`/data/code/logos` (remote `github.com/shadhq/logos`) holds the flake at its root and every machine
under `fleet/`, and what explains them: the plans in flight in `.plans/`, `docs/decisions/` (one rule
per file; read `docs/decisions/AGENTS.md`), `docs/VOCABULARY.md` and `fleet/check`. The machines were
their own repository, egghead, until logos 16 merged its history into `fleet/` (2026-10-11); logos 28
deleted egghead's own checkout and archived `shadhq/egghead` (2026-10-11). This skill keeps the name.
Before that, ops-next was merged into egghead at step 19a (2026-10-04). A step is one commit, so a
step's name finds its change and its step file in one tree: `git log --grep '^step 19a:'`. Retired names
appear only in history: `ops-next`, `punk-records` (the folder and this skill, until step 21b),
egghead's old checkout, and `ragnarok` (the GitHub repository, which still redirects; never create a
repository named `ragnarok` under `shadhq`, or the redirect breaks).

## Layout

```
flake.nix                 (logos' root) inputs; one module list per machine; the cross-machine derivations (cleanup 19f); packages; the list of checks, each a file beside what it tests (cleanup 19h)
fleet/machines/<machine>/ one folder per nixosConfiguration and nothing else: punk, desktop, snake, shark, hawk, rescue, installer
fleet/modules/           a declaration two or more machines import
fleet/constants/         a value two or more machines read, or one reads about another: one file per value
fleet/tests/             VM tests and fixtures, used by checks
fleet/bin/               operator tools run against a live machine (fleet/bin/hawk, fleet/bin/snake, …)
fleet/secrets/<machine>/ one sops file per secret; fleet/secrets/default.nix lists them without a key
.plans/<plan>/           (logos' root) one folder per plan in flight, deleted when it closes (the plans skill)
docs/decisions/          one rule per file (docs/decisions/AGENTS.md)
docs/VOCABULARY.md       every name chosen, and the check that chose it
fleet/check              the citations, retirement and vocabulary checks
flake-check              (logos' root) the Nix gate, what `nix flake check` checks, evaluated in parallel
```

The machines: **punk** is the physical host (ZFS, Incus) and runs no service of its own beyond
what `docs/decisions/0037` allows (reach, data, guests, shares; its closed list is
`fleet/machines/punk/host-list.nix`). **desktop** is the operator's workstation, a privileged Incus
container on punk; no service may depend on it. **snake** is an Incus VM on punk running the
house's services and the lake pipeline. **shark** is an unprivileged Incus container on punk that
computes on the GPU the desk also uses: the card's compute nodes only, no privilege, its `/var/lib`
on a ZFS volume (step 21c). **hawk** is the rented Hetzner server (barzakh's machine
until step 17 reinstalled it as hawk) and runs the public services directly. **rescue** and
**installer** are escape hatches. Global invariant 1: no service runs on the punk host or on the desk.

## The rules, and why

1. **Where a file goes is `docs/decisions/0041`.** One folder per nixosConfiguration under
   `fleet/machines/`, nothing else there; a file only one machine uses in its folder, the program a
   module runs beside it; a declaration two machines run in `fleet/modules/`; a value two machines
   read, or one reads about another, in `fleet/constants/`; no file reads another machine's folder.
   `checks.machine-folders` is red on a breach. The apps the machines run are the flake's own
   (`self`, logos 17), not an input.
2. **A declaration two machines share is one module in `modules/`, never a copy.** Why: copies
   drift silently; a fix to one never reaches the other. `modules/offsite.nix` is the second
   fix of a known copy (cleanup 19d, 2026-10-12): punk's and hawk's offsite backups shared 122
   lines of code, byte-identical, now one module with options for what each machine copies, its
   directory on the box, its key and punk's clone of snake's volume; `machines/punk/offsite.nix`
   and `machines/hawk/offsite.nix` hold only that. cleanup 19g did the same for the rest: five
   modules, each named for what it configures and imported by the machines that run it, never a
   catch-all (no one module is common to every machine): `zfs-boot.nix` (the pinned ZFS; punk,
   hawk, rescue, installer), `zfs-pool.nix` (`rpool`'s flags and the `local`/`safe` split, with
   `zfs-pool.refreservation`; punk, hawk), `snapshots.nix` (sanoid's `precious` template; punk,
   hawk), `ssh.nix` (password and keyboard-interactive login off; punk, hawk, snake, shark) and
   `admin.nix` (the `admin` account, sudo, Nix's settings; punk, hawk). What stays per machine:
   keys, `PermitRootLogin` on the guests, `systemPackages`, locale, `stateVersion`, the scrub
   interval. Do not add a third copy: extract first.
3. **A module in `modules/` names nothing true of one machine only.** An address, an interface,
   a peer is an option with no default, set in that machine's list in `flake.nix` (step 15's rule,
   `docs/decisions/0010`, one source per fact). A module in `fleet/machines/<machine>/` may hold its own
   machine's place as constants.
4. **The import list names everything a machine runs: `docs/decisions/0042`.** Imports listed by
   hand; importing a module turns it on; no `enable` option; no automatic import of a directory.
5. **Never keep a list of machines, files or units by hand** (`docs/decisions/0029`). Derive it from
   the declaration and make the flake red when they disagree: `checks.host-list`,
   `checks.secret-set`, the backup sets (`nix build .#hawk-backup-set`). The Storage Box's
   `authorized_keys` and Prometheus's node scrape targets are derived in `flake.nix` from the
   machines (cleanup 19f), and `RemoteWriteMissing`'s rules are held to the derived writers by
   `checks.prometheus`. `checks.zfs-parity` and `checks.nvidia-parity` pick their machines by rule,
   and there is one `<machine>-backup-set` package per machine that builds one (cleanup 19h).
6. **One shape across services** (`0028`). A scheduled job is a `Type=oneshot` unit, a timer and a
   status unit that writes through `fleet/modules/status-file.nix`; exit codes follow
   `docs/decisions/0039`; state goes in `StateDirectory`; produced records go to the lake
   (`docs/decisions/0040`); only state is backed up (`docs/decisions/0036`). Before writing a service,
   copy the shape of the nearest sibling, not a new one.
7. **Secrets never touch disk in plaintext.** One sops file per secret in `fleet/secrets/<machine>/`,
   opened by the machine's own SSH host key, the Mac's key and the recovery key (`fleet/.sops.yaml`,
   `fleet/RECOVERY.md`).
8. **Addresses are IP literals on purpose** where a resolver would be a dependency (Prometheus:
   punk's alert pushes died with its DNS once). Another machine's address written in many files is a
   known debt: cleanup 19e gives every address one source. Until then, copy the literal its
   siblings use and do not invent a second form.
9. **Machines follow the same patterns** (operator, 2026-10-02; step 15b Findings 22): ZFS split
   into `local` and `safe`, sanoid on `safe`, restic to an append-only Storage Box sub-account,
   status files read by `freshness`, sops opened by the machine's host key and the recovery key,
   built where `docs/decisions/0022` puts the work and never on hawk, switched from the desk. A
   difference is written down with its reason where the machine is declared.
10. **A new Incus state volume is a ZFS dataset**, never a zvol formatted ext4 (operator,
   2026-10-05, step 21c: "any new disk that get created should [be] zfs").
11. **hawk may be down for 24 hours without loss or emergency** (operator, 2026-10-02 and
   2026-10-03; step 16c Findings 11): every byte of state it holds has a copy off it, at most an
   hour old, that has been restored once; what stops while it is down is written per service,
   and nothing on punk, snake or the desk stops with it. Rebuilding hawk elsewhere from the flake
   and that copy has never been drilled.
12. **Services are added as they are needed** (operator, 2026-10-04: "no limit, we add the
   services we need"); a service of the old tree returns only when `fleet/MISSED.md` says it was
   reached for. The old tree is deleted (cleanup 22c); its last published state is `shadhq/ops` at `6d7ec9e`.

## Considered and rejected — do not re-propose without the trigger

- **Organising by feature (the dendritic pattern).** (`docs/decisions/0042`) Its lessons are taken (rules 2, 4, and no
  `specialArgs`, cleanup 19h); its mechanism is not, because automatic import hides what a machine
  runs. Trigger to revisit: `fleet/modules/` holds more Nix code than `fleet/machines/` (337 against 6,592 on
  2026-10-04), parked in `/data/code/ideas/2026-10-07-dendritic-repo-layout.md`.
- **Clan.** (`docs/decisions/0041`) Its lesson is taken: one side of a multi-machine service derived from the other (cleanup
  19f). Clan itself loses: its secrets system is experimental with no guaranteed migration, it
  would replace the sops design, its library lacks restic-to-append-only and headscale, and it
  changes fast. Step 15 rejected its inventory in small ("a placement table … what a cluster
  would bring, not evidence about whether one is needed").
- **A folder per service.** (`docs/decisions/0041`) Right only for workloads a scheduler places. If a Kubernetes cluster
  is ever justified (ops decision 0052 gates it: a written reason first), machines stay in
  `fleet/machines/` and workloads go one folder per service, rendered from Nix (nixidy); the escape
  hatches (headscale, the WireGuard hub, backups) stay plain systemd units. A CronJob cannot run
  one job after another; the lake pipeline relies on systemd's `After=`.
- **Separate repositories for docs, plans or config.** (`docs/decisions/0041`) Two repositories turned every step into
  two commits joined by a hand-copied hash and left citations uncheckable; step 19a undid that.

## How a change is made

- **Plans.** Work that spans sessions is a plan in `.plans/<plan>/`, run and closed as the plans
  skill says. Open on 2026-10-07: `cleanup` (no new features: the copies, the hand-kept lists, the
  barzakh copy, the cutover-era documents, the old tree) and `meetings` (the meeting partner, at
  the operator's own pace). A new feature is a plan of its own, never steps on a running one;
  work pushed out is a parked idea in `/data/code/ideas` (the ideas skill). The first plan, the
  study ladder of steps 00–21, closed on 2026-10-07: cite its steps as `step NN`, and read one
  with `git log --grep '^step NN:'`.
- **A gate waits for a timer only when the change adds or changes that timer**, its unit or its
  status unit. Every other gate starts the unit by hand, which runs the same program; a timer
  run that must still be seen is an Open item of the plan, never waited for.
- **Names.** Every new name is checked against `docs/VOCABULARY.md`: a standard word in its standard
  sense, never a word already taken (`docs/decisions/0035`). `base`, for example, is taken.
- **Gates.** On the desk, at logos' root. `bun run check:staged` before every commit (logos'
  AGENTS.md): it runs `./flake-check`'s selection, the Nix attributes the diff touches (logos 09),
  each machine printed as `machine <name> <drvPath>`; `./flake-check --all` evaluates everything.
  `fleet/check` (citations and retirement inside `fleet/`) is not part of `check:staged`: run it
  before a build, before its commit, and again after the commit. Every gate ships with a fixture
  proving it can fail (`docs/decisions/0008`). A refactor is proven by unchanged store paths
  (step 15 did this for `hello`): diff two runs' `machine` lines.
- **Deploys.** `fleet/bin/hawk deploy` runs from the desk. `fleet/bin/snake deploy` and
  `fleet/bin/desktop deploy` drive Incus, so they run on punk as admin, from the desk through ssh:
  `ssh admin@punk 'cd /data/code/logos && fleet/bin/snake deploy'` (on the desk they stop with
  "incus not found — run this on punk as admin"; published-readme 01). punk's
  `/data/code/logos` is the desk's tree, uncommitted edits included, so it deploys what the
  desk holds. punk's own switch is the operator's (it needs sudo). Nothing is built on hawk.
  A ZFS quota in `fleet/machines/punk/storage/pool.nix` or `fleet/machines/punk/lake-buckets.nix` is
  applied when a disk is formatted, never at a switch: a change to one also runs `sudo zfs set quota=`
  on punk (personal 07, which assumed the switch would).
- **shark's CUDA programs are fetched, never compiled.** They come from `pkgsCuda`, which the
  NixOS CUDA team's cache holds; only `fleet/bin/shark` trusts that cache, per command, and its
  `dry-run` refuses a build that would run `nvcc`. Never `nix build` shark or
  `.#whisperlivekit` by hand, on the desk or on punk: it compiles CUDA (step 21p).
- **Run a lake job; never wait for its timer.** Work that needs a fresh run of a snake job
  (bronze-load, silver-build, jira-ingest, …) runs it now, from the desk:
  `ssh admin@punk 'cd /data/code/logos && fleet/bin/snake run bronze-load silver-build'`,
  jobs in pipeline order. An early run does what the scheduled one would, costs seconds, and
  is not an intervention to log; re-running a *failed* job is (`docs/decisions/0033`). `run` itself
  waits while another job runs or a timer is due within a minute, because the timers are
  spread so no two jobs share snake's memory; if it gives up after 10 minutes it names the job in
  the way and when to try again. Never `ssh root@snake … systemctl start`: it skips that check.
  `run` prints none of the job's own lines (counts, what changed, a problem it counted); a gate
  reads them from snake's journal (ticket-context 03):
  `ssh admin@punk 'incus exec snake -- env PATH=/run/current-system/sw/bin journalctl -u silver-build.service -n 50 --no-pager'`.
- **Removing a record from the lake** is `sudo fleet/bin/lake purge` on punk for the records in
  `fleet/machines/punk/lake-purged.tsv` (`docs/decisions/0043`); never `rm` under `/lake`, never a
  hand-written `DELETE`. `fleet/bin/lake show` looks first; `fleet/bin/lake query` replaces the
  hand-copied catalog recipe.
- **Log an intervention.** When you act on something already live because it did not do what it was declared to do (re-run or unlock a failed job, repair a deploy that broke a service, a credential or a disk that ran out), or the operator says something broke and you fix it, append one line to `fleet/INTERVENTIONS.md` before the session ends: `YYYY-MM-DD <service> — what broke; what was done`. The file's header says what counts and what does not: a plan step's own work, an early run of a healthy job and a fault in work not yet deployed do not. Commit the line with the fix when there is one, otherwise alone as `interventions: <service> — <what was done>`. Write it when it happens, never from memory of an earlier session, and never leave it uncommitted (decision 0033).
- **Commits.** A plan's step is one commit: `cleanup 19d: shared-module — <what is now true>`
  (the first plan's were `step NN: …`); outside a plan `<machine or area>: <what is now true>`;
  planning `plan: <plan> — …`. In prose a step is `step NN` or `cleanup 19d` here, and
  `egghead step NN` in another repository. Read the `commit` skill.
- **Citations** name a heading or a symbol, never a line number, and resolve in the tree they are written in
  (`docs/decisions/0024`). `fleet/check` is red on a path into this tree that does not resolve, and on any path into
  `.plans/` from outside it (a step is cited by name, so closing a plan breaks nothing); it does not read
  `.plans/`. A move or delete fixes every citation in the same commit, a gone file is named without its path,
  another repository's path is written absolute.

## What the first plan paid to learn

Each cost a build session at least once; most cost several (the step's Findings, through
`git log --grep '^step NN:'`). Check here before a design leans on any of these.

- **A green build can be a cache hit.** If the derivation was already built (a study pre-built
  its fences, an earlier step built the same thing), `nix build` "passes" without running
  anything. The first green after landing a design uses `--rebuild` (steps 04, 05, 08, 10b).
- **`nix flake check` reads the working tree**, uncommitted edits included, and a new file is
  invisible to the flake until `git add -N` (steps 05, 16b). Never edit flake files while a check
  on them runs.
- **`nix fmt` reflows lines you did not touch.** Format only the files you changed, and read the
  diff (steps 18f, 21a, 21g).
- **`nix build --print-out-paths` prints one line per output**: a package with `out` and `man`
  gives two paths (step 16d).
- **Long builds and VM tests** (a hawk change, any VM test: minutes) run as a tracked job with a
  long deadline, never a bare `&`, which a tool timeout kills silently. VM checks need `/dev/kvm`
  in the desk; without it QEMU falls back to TCG, about 3× slower (steps 12n, 16c–16g, 16j).
- **bash's `set -e` does not apply inside a function called from `if`, `||` or `x=$(…) ||`**: a
  check that crashes there prints nothing and returns 0. Capture a status as `fleet/check` does:
  `set +e; ( set -e; … ) >out 2>&1; status=$?; set -e` (step 04b).
- **`git log --diff-filter=D` does not see a decision renumbered by a rename**; compare the sets
  of numbers before and after (steps 04b, 04c).
- **A command sent over ssh is parsed twice**, locally and by the remote shell: quote each
  argument with `printf '%q '`, as the barzakh copy's `remote` did (`git log --grep '^step 16a:'`).
- **`incus exec` into a NixOS guest has Incus's bare `PATH`**: prefix ad hoc commands with
  `PATH=/run/current-system/sw/bin`, as `bin/snake`'s `kexec` does (steps 09, 12g, 12i, 12n).
- **Incus's `systemd.credential.*` keys store the value in plaintext** in the instance and in
  Incus's database: never use them for a secret (step 09).
- **A guest is recreated under a new name, never renamed in place.** Incus renames a bridge only
  when nothing uses it and an instance only when stopped, and its preseed never deletes: delete
  the old profile and network first, then let the rebuild create them; a guard table dropped
  from the flake is removed at the next nftables reload, never by hand (steps 09, 21a).
- **systemd surprises.** `OnFailure=` fires at every retry of a `Restart=on-failure` unit unless
  `RestartMode=direct` (step 12). A successful oneshot's `InvocationID` is cleared, so take a
  journal cursor before starting a unit, not its id after (step 21q). A `systemd-run --pipe`
  unit's journal match needs `INVOCATION_ID=` as well as `_SYSTEMD_INVOCATION_ID=` (step 12b). Under
  `DynamicUser=`, a `StateDirectory=` is re-owned only when its top directory has the wrong
  owner (step 05), and moving a unit off `DynamicUser=` does not re-own its `CacheDirectory=`
  (step 18f). A unit sharing a service in `OnSuccess=` and `OnFailure=` loses `$MONITOR_*`
  with only a journal warning (step 08).
- **sops-nix's `/run/credstore/<id>` is a symlink** to `/run/secrets/<id>`: a gate checks it
  with `stat -L` (step 16f). The desk's `/tmp` is ZFS, persistent disk: never stage a secret
  there, not even in a test (step 06).
- **DuckDB:** `len(list(x))` over zero rows is NULL, not 0; wrap it in `coalesce` (steps 12j,
  12l). `duckdb -csv` quotes a line holding a comma, and a `grep '^…'` gate then drops it
  (step 14). Its memory limit is the one jobs hit first: spill to the unit's own cache
  directory (bronze-load, silver-build).
- **gitleaks flags harmless strings**: a public NATS nkey, an identifier pairing `linkedin`
  with a 14-letter word. Allowlist each in `fleet/.gitleaks.toml` with its reason (steps 12m, 16e).
- **No `perl` on the desk.** A throwaway rewrite script uses `python3` (step 19a; again at
  the first plan's close).

## Planned changes to this layout (cleanup 19e–19h)

Do not anticipate them in unrelated work, and do not contradict them. When one lands, update
this skill in the same change. 19d shared-module landed 2026-10-12: `modules/offsite.nix`,
rule 2 above; 19f derived-peers landed 2026-10-12; 19h flake-outputs landed 2026-10-12.

| Step | Changes |
|---|---|
| 19e addresses | one file for every machine's addresses |
| 19g machine-module | one module for what every machine shares |

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
- The full comparison: step 19c, Findings (`git log --grep '^step 19c:'`).
