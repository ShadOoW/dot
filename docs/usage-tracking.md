# Software Usage Tracking

`dot usage` answers one question with evidence instead of memory: **which installed
software is actually used, and what can therefore be removed.**

827 xbps packages are installed on this host, of which **117 were asked for and 710
came in as dependencies**. Guessing which of the 117 you still use is unreliable — see
"Why guessing fails" below, where every package a careful reviewer nominated as unused
turned out to have been run within the week.

```
dot usage status               # is tracking working, and what can each source see
dot usage collect --all        # one sample, all four sources (safe to run any time)
dot usage report               # what is used: ranked by invocations and by wall time
dot usage unused               # what nothing has used and nothing needed depends on
dot usage unused -d 180 --all  # stricter window, full list
dot usage acct on              # enable kernel process accounting (asks for a password)
```

Works on both halves of this dual-boot machine: **xbps** (827 packages) and **pacman**
(2099). The database is auto-detected, and `--pkgdb` can point at the other root's.

> **Never write `sudo dot`.** It fails with `sudo: dot: command not found`, because `dot`
> is a shim in `~/.local/bin` and sudo replaces `PATH` with its compiled-in
> `secure_path`. Subcommands that need root escalate themselves and prompt:
>
> ```
> $ dot usage acct on
>   · turning process accounting on needs root (CAP_SYS_PACCT) — escalating with doas
>   doas (shad@saykuk) password:
> ```
>
> The prompt then belongs to the command that actually needed the privilege, and the
> reason is on screen next to it. `dot usage acct status` needs no root and never asks.

---

## Why guessing fails

Before this existed, a review of the 117 manual packages nominated eleven "probably
unused" candidates. Measured against six months of real evidence, nine were wrong:

| Nominated as unused           | Actual evidence                                 | Verdict                   |
| ----------------------------- | ----------------------------------------------- | ------------------------- |
| `android-tools`               | `adb` run **245** times, last 2 days ago        | in active use             |
| `feh`                         | **74** invocations, last 17 days ago            | in active use             |
| `steam`                       | **23** invocations, last **today**              | in active use             |
| `lftp`                        | **19** invocations, last 4 days ago             | in active use             |
| `jpegoptim` / `pngquant`      | 11 and 6 invocations; binaries read 28 days ago | in use                    |
| `curlftpfs`                   | 6 invocations, last 86 days ago                 | borderline, inside window |
| `newsboat`, `element-desktop` | last run inside the window                      | keep                      |
| `pandoc` (206 MB)             | **never observed by any source**                | genuine candidate         |
| `libwebp-tools`               | last run 152 days ago                           | genuine candidate         |

Intuition tracks _what you think you use_. `adb` at 245 invocations is not something
anyone recalls doing.

---

## The four sources, and how each one lies

There is no single signal on Linux that answers "was this binary used". Each available
source is wrong in a different, known direction, so `dot usage` records them
**separately** — one row per `(executable, source)` — and the reports say which sources
back each verdict. Collapsing them into one number would discard exactly the
information needed to know whether an answer is safe to act on.

| Source    | Sees                                                               | Blind to                                                        | Needs root                 |
| --------- | ------------------------------------------------------------------ | --------------------------------------------------------------- | -------------------------- |
| `acct`    | **every** process that exits, via kernel process accounting        | full paths — only `comm[16]`, so `node`/`python3` are ambiguous | yes, to enable             |
| `proc`    | full binary path of anything alive at poll time                    | anything that lived less than one interval                      | yes, for other users' PIDs |
| `atime`   | last read of every package executable, **retroactively for years** | ~1 day granularity; destroyed by full-tree reads                | no                         |
| `history` | interactive commands, with **six months** already on disk          | anything not typed at a prompt: services, libraries             | no                         |

`acct` and `proc` are exact complements: accounting has the counts, `/proc` has the
identities. `atime` and `history` are what make the very first report useful instead of
empty — nothing else can speak to the past.

### The safe direction

Aggregation takes `max(last_seen)` across sources. So every failure mode above — a
polluted atime, a `comm` collision, a double-counted poll — can only make software look
**more** used than it is. The tool is biased toward under-removal, which costs disk
space; the opposite bias costs a working system.

### atime pollution, and why it is filtered rather than distrusted

Any process that reads every file under `/usr` — a backup, `xbps-pkgdb -a`, an unscoped
`grep -r` — rewrites thousands of atimes to one instant. Measured on this host: **1073
of 1827 executables (59%) shared the single hour `2026-06-28 22h`**, plus a second clump
at `2026-08-08 05h`.

The response is not to throw atime away. An atime _older_ than a sweep proves the sweep
never reached that file; one _newer_ proves genuine access since. Both are still true.
Only the values sitting inside the clump carry no information, so `scanAtimes` drops any
hour holding ≥15% of all executables and reports what it discarded:

```
! discarded 1533 of 1827 atimes: 2 hour(s) (2026-06-28 22h, 2026-08-08 05h) each hold
  >=15% of all executables, i.e. a full-tree read, not use
```

Those executables become "no data" and the other three sources decide.

> **Do not run `xbps-pkgdb -a` casually.** It reads every packaged file and will flatten
> the atime signal for the whole system. The same goes for any backup that walks `/usr`.

### Coverage: absence of evidence vs evidence of absence

`unused` refuses to sound confident on thin data. It reports how far back each source's
evidence actually reaches and names any that cannot see the requested window:

```
! proc, atime have less than 90 days of history — treat this list as provisional
  until the collector has been running that long
! process accounting is off, so short-lived commands are invisible
```

A freshly-installed collector has minutes of `proc` data and would otherwise "prove"
that almost everything is unused.

---

## Why a library is not judged on its own

A shared library is never `exec`d, so a naive exec-based rule nominates every `.so` on
the system — and 710 of 827 packages here are dependencies.

So usage is **seeded** on packages that were actually run, then pushed **down** the
dependency graph: anything reachable from something in use is needed, transitively. What
remains is genuinely unreferenced.

Both databases feed one graph builder, since resolving dependency patterns through
`provides`, inverting to reverse dependencies, and taking the protected closure are
identical work whichever manager supplied the facts:

|        | source                                             | parse               | validation                                                                                                             |
| ------ | -------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| xbps   | `pkgdb-0.38.plist` + one `.<pkg>-files.plist` each | ~63 ms / 828 pkgs   | matches `xbps-query -X` **exactly** on `libcap`, `ncurses-libs`, `libpcre2`, `libxml2`, `sqlite`, `zsh`, `wlroots0.19` |
| pacman | one `desc` + `files` per package dir               | ~566 ms / 2099 pkgs | **zero** of the literal dependency edges in all 2099 `desc` files are missing from the graph                           |

Two pacman format traps worth knowing, both covered by tests: `%REASON% 1` means
_dependency_, so **absence** of the section means explicitly installed — the opposite
polarity to xbps's `automatic-install`; and `files` records paths relative to the root
with no leading slash and directories suffixed `/`. Dependencies also appear as sonames
(`libcrypto.so=3-64`), which only resolve through `provides` — miss that and `openssl`
comes back unreferenced.

Verdicts. Two facts decide the label: **who wanted the package**, and whether it has
anything to execute. "Who wanted it" comes first, because that is the axis you act on.

| Reason          | Meaning                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------- |
| `manual-unused` | you asked for it, it has executables, nothing has run them                                                     |
| `orphaned`      | came in as a dependency, and nothing still wanted needs it — **transitively**, so broader than `xbps-query -O` |
| `dead-library`  | a library **you** installed that ships no executables and has no live dependants (`openssl-devel`)             |
| `passive`       | **cannot be judged by execution at all** — reported separately, never recommended                              |

`dead-library` deliberately does not mean "any `.so`". A dependency-installed library with
no surviving dependants is `orphaned` — which is what `xbps-query -O` calls `wlroots0.19`
on this host, and labelling it a dead library would have read as "you installed a library
you never used".

### `passive`: the class that makes exec-based tools dangerous

Some packages are used by something that never calls `exec`. This is not a rare corner —
a purely exec-based verdict on this host nominated, for removal:

- `intel-ucode` — the i5-13500's microcode, loaded by the kernel from
  `/usr/lib/firmware`
- `glibc-32bit` — **69 dependants**, mapped only by the 32-bit ELF interpreter
- `mesa-vulkan-intel` — `dlopen`ed via `/usr/share/vulkan/icd.d`
- `linux-firmware-nvidia` — read by the kernel at device init

Classification is by the **shape of the paths a package owns**, never by name, so it
survives package-set changes: `/usr/lib/{firmware,modules}` → `firmware`;
`/usr/lib/dracut` → `initramfs`; `/usr/share/vulkan`, `/usr/lib/dri` → `driver`;
`/usr/lib32` → `multilib`; `/usr/lib/{security,gio/modules,qt*/plugins,…}` → `plugin`;
`/etc/sv`, `/etc/systemd/system` → `service`.

`passive` applies only when a package ships **no** executables. One that ships both a
binary and a service unit stays judgeable by exec — the unit runs the binary — and its
row is annotated so the other consumer stays visible:

```
manual-unused elogind        2.6 MB  6mo ago  [service,initramfs,plugin]
```

On this host that separates **88 unjudgeable packages (1.5 GB)** from the actual
candidates.

---

## Enabling the collector

Reports work immediately from `atime` + `history`. Live exec tracking needs the service.

```sh
dot pkg usage link             # symlink the service definition (runit or systemd)
packages/usage/configure.sh   # create /var/lib/dot, log dir, rotation; asks for a password
dot pkg usage enable          # register with the init system
dot usage acct on             # complete short-lived-command coverage; asks for a password
```

Every step that needs root asks for the password itself — none of them take `sudo`.

The collector runs as **root**, because that is the only way to resolve
`/proc/PID/exe` for other users' processes — measured as uid 1000, 168 of 636 PIDs were
readable, and the invisible ones are the supervised daemons. It writes
`/var/lib/dot/usage.db` (world-readable, WAL, so reports never block the writer);
without root it falls back to `~/.local/state/dot/usage.db` and says so.

Cost per tick: ~3 ms for a 625-PID `/proc` poll at a 10 s interval. `atime` and
`history` re-derive historical facts, so they run hourly, not per tick.

### Process accounting

The kernel has `CONFIG_BSD_PROCESS_ACCT_V3=y`, so it can append a 64-byte record for
**every** exiting process — the only way to see `ls`. `dot usage acct on` calls `acct(2)`
through libc via `bun:ffi` rather than depending on GNU `acct` (not installed here, and
its only job would be that one syscall — the records are parsed directly either way).

The file stays small because the collector **truncates it after each read**. That is safe
because `acct_on()` opens it `O_APPEND`, so kernel writes are positioned at the current
end of file regardless of length; after a truncate the next record lands at offset 0. At
64 bytes per process an untended file would grow by megabytes a day.

`/var/lib/dot/pacct` is mode `0600`: it records every process every user runs.

---

## Caveats worth knowing

- **`/home` is shared with the Arch install**, so atuin history contains commands typed
  on the other distro — `pacman`, `yay`, `systemctl` all appear while booted into Void.
  This is left in deliberately: attribution resolves against _installed_ packages only,
  so an Arch-only command lands under manager `unknown` and can never credit a Void
  package. Where a name exists on both, the effect is to mark it used.
- **`comm` is 16 bytes.** Accounting and history sightings that match exactly one
  package's executable name are attributed; ambiguous ones are counted under manager
  `ambiguous` and credited to no package, because guessing would put fake usage on the
  loser.
- **Only the distro's own manager is judged.** `nix`, `cargo`, `bun`, `fnm`, `uv`,
  `/usr/local`, `~/.local/bin` are recorded and shown in `report` — useful on this host,
  where `zig`, `iii` and `iwmenu` are hand-dropped binaries no manager will ever
  upgrade — but `unused` only makes removal claims about xbps or pacman packages, where a
  dependency graph exists. A nix binary sharing a name with a distro package cannot
  vouch for it.
- **Protected set.** A dependency closure, never a hand-written list, so it stays correct
  as the distro's base changes: `base-system`/`base-files`/`xbps`/libc plus every kernel
  on Void (137 packages), `base`/`pacman`/`filesystem`/libc plus kernels on Arch (171).
- **`--pkgdb` crosses roots, evidence does not.** Pointing at the other install's
  database gives a valid dependency graph, but atime and `/proc` still describe the
  _running_ system. `collect` says so rather than letting it read as "nothing is used":
  `38568 of 41973 package executables do not exist on this filesystem`.

## Files

| Path                                              | Role                                                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `/data/code/fleet/apps/dot/src/lib/usage.ts`      | sources, xbps index, store, dependency propagation                                               |
| `/data/code/fleet/apps/dot/src/commands/usage.ts` | `collect`, `daemon`, `report`, `unused`, `acct`, `status`                                        |
| `/data/code/fleet/apps/dot/src/lib/usage.test.ts` | 28 tests over the plist reader, the `acct_v3` layout, command parsing, and the propagation rules |
| `packages/usage/`                                 | runit service, systemd unit (in `etc-real/`), `configure.sh`                                     |
| `/var/lib/dot/usage.db`                           | the store                                                                                        |
| `/var/lib/dot/pacct`                              | kernel accounting spool, drained each tick                                                       |
