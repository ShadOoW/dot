# oom — memory safety

Minimal setup so **the system itself never runs out of RAM**, and so an OOM kill is never
silent.

```sh
dot link oom            # user unit + ~/.local/bin/oom-notify
dot pkg oom configure   # earlyoom, /etc drop-ins, sysctl, enable everything
```

| Part                                      | Does                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| `earlyoom -M 2.5G,1.25G -S 6G,3G`         | kills the largest offending **process** before the kernel's blunt killer runs   |
| `system.slice` `MemoryMin=1G`             | a floor of memory the kernel will not reclaim from system services              |
| `user@.service` `OOMScoreAdjust=0`        | stops the kernel preferring your session manager over the real hog              |
| `~/.local/bin/typescript-language-server` | 3 GiB heap ceiling on tsserver for clients that cannot send `maxTsServerMemory` |
| `oom-notify.service`                      | red, non-expiring notification on any OOM kill                                  |

## Why `-s 100,100` was right, and why it is now wrong (2026-08-01 → 08-05)

earlyoom's `--help`, verbatim:

> Note: **both** memory and swap must be below minimum for earlyoom to act.

That AND clause silently disabled earlyoom on this box. With ~39 GiB of swap advertised
(23 GiB zram + 16 GiB NVMe swapfile), swap-free never got near 10% before physical RAM was
exhausted. At the 2026-07-30 23:01 freeze:

```
Node 0 Normal free:19540kB   min:64308kB      <- RAM gone
Free swap = 27990116kB                        <- swap 68% free
```

Memory was catastrophically low, swap looked healthy, so earlyoom stayed asleep, the kernel
OOM killer stayed asleep, and the machine hard-locked. Pinning the swap threshold at 100%
made that clause always true, reducing the trigger to the memory condition alone.

**That premise expired when the zram device shrank.** Swap is now 24.3 GiB of which 16 GiB
is real NVMe — capacity that genuinely absorbs pressure — so swap-free is a meaningful
signal again. Meanwhile the un-gated memory condition produced two kill storms:

```
Aug 03 17:27-17:28   177 kills in two minutes
Aug 04 20:30          19 kills, with swap 73% FREE (18 of 24.3 GiB)
```

Neither was an out-of-memory condition; the kernel OOM killer did not fire in either.

The storms happen because **VmRSS overstates what killing a browser process returns.**
Renderers share most of their pages. Measured across Vivaldi's 38 processes on 2026-08-05:

```
sum RSS = 10107 MiB      <- what earlyoom scores and reports
sum PSS =  5086 MiB      <- what a kill actually gives back
```

earlyoom killed a "326 MiB" renderer, recovered ~160 MiB, stayed under the threshold, and
killed again — 177 times, with no swap gate left to stop it. This is the same PSS-vs-RSS
effect `src/lib/memory.ts` documents for `dot sgc`.

`-S 6291456,3145728` restores the brake: 6 GiB free swap means zram is full **and** ~10 GiB
of the NVMe swapfile is gone. Combined with <2.5 GiB available RAM that is a real emergency.
Against the Aug 04 event, this configuration would not have fired at all.

## Absolute thresholds, because the percentages moved

`-m`/`-s` are percentages of earlyoom's **"user mem total"**, not `MemTotal`:

```
mem total: 31852 MiB, user mem total: 20162 MiB
```

So `-m 10,5` fired at ~2.0/1.0 GiB, not the "~3.1 GiB of 31" this file used to claim. Worse,
user-mem-total tracks unreclaimable kernel memory — the Aug 04 logs show it drifting between
20555 and 21501 MiB — so the trigger point wandered under load, which is precisely when it
must not. `-M`/`-S` take absolute KiB and hold still.

## The freeze this package did not catch (2026-07-28 → 08-01)

Distinct from the OOM below. Four consecutive boots ended with **no shutdown sequence in
the journal** — a hard lock, not a kill. Root cause was a zram reclaim livelock: to swap a
page out zram must allocate a page, that allocation fails at the watermark, so the swap-out
fails and `kswapd` cannot make progress. `mode:0xc0de0` on every failure is the `zsmalloc`
signature; `zspages` climbed to 3.8 GiB.

Full write-up and kernel evidence: **`docs/zram.md`, "The 0.75 freeze"**. The fix has four
legs and none is sufficient alone; **none of them is earlyoom** — earlyoom is the backstop
for when they fail, not the defense itself:

| leg                                                           | package                                                    |
| ------------------------------------------------------------- | ---------------------------------------------------------- |
| zram device 0.75 → 0.25                                       | `packages/zram`                                            |
| `min_free_kbytes` 64→512 MiB, `watermark_scale_factor` 10→200 | `packages/zram/etc-real/etc/sysctl.d/30-reclaim.conf`      |
| zswap off (it was on by default, stacked in front of zram)    | `packages/zram/etc-real-systemd/etc/tmpfiles.d/zswap.conf` |
| `earlyoom` thresholds                                         | **this one** — backstop only                               |

The zswap leg was found on 2026-08-05 and had been on since install: linux-zen ships
`CONFIG_ZSWAP_DEFAULT_ON=y` and nothing here disabled it, so every anon page was compressed
into a RAM pool and then compressed _again_ by zram. It adds a fourth allocate-to-reclaim
step in front of `zsmalloc`'s — the same hazard, one layer up.

The watermark sysctl is in `zram` rather than here on purpose: it is headroom for
`zsmalloc`, it applies to both inits, and this package is Arch/systemd-only. **Void gets the
zram and sysctl legs but has no earlyoom** — see `packages/zram/README.md`.

Named allocators in the failure dumps, worth watching: `Bun Pool 2` in
`cpuset=lake-collect.service` (3 of 5 events; that service was at 2.3 GiB with
`MemoryMax=infinity`), plus `zsh` and `kswapd0`. `lake-collect` is defined in `/data/ops`,
not here — capping it is an ops-repo change, not a dotfiles one.

## What actually went wrong (2026-07-28 17:33)

From the kernel's own task dump — not guesswork:

| process             | procs | RSS+swap    | `oom_score_adj` |
| ------------------- | ----- | ----------- | --------------- |
| `node-MainThread`   | 26    | **8.5 GiB** | 0               |
| `bun`               | 5     | **4.8 GiB** | 0               |
| `claude`            | 8     | **2.5 GiB** | 0               |
| `mpvpaper`          | 1     | 1.8 GiB     | 0               |
| `kitty`             | 14    | 0.9 GiB     | 0               |
| `vivaldi-bin`       | 6     | 0.9 GiB     | **200**         |
| `user@1000` systemd | 1     | trivial     | **100**         |

26.8 GiB in use on a 31 GiB box. **It was the Node/Bun toolchain, not the browser** —
node+bun+claude alone were 15.8 GiB, ~59% of everything. Vivaldi was 0.9 GiB.

The kernel then did precisely the wrong thing, for understandable reasons: it killed
vivaldi's renderers first (correct — chromium self-marks them `adj=200/300` as sacrificial),
freed almost nothing because they were tiny, and escalated to the process with the next
highest score — your session manager at `adj=100`. With no manager the session could not be
reaped: `session-c1.scope` survived `SIGKILL`, shutdown hung 90 s, and `/home/shad/.cache`
failed to unmount.

So the fix is not "more swap". It is: kill the right process, earlier, and stop biasing
against the session manager.

## Why earlyoom and not systemd-oomd

`sway` is started by `ly`, not by a systemd user session, so **every GUI app lives in one
cgroup** — `user.slice/user-1000.slice/session-c1.scope`, currently ~15.3 GiB:

```
kitty            -> /user.slice/user-1000.slice/session-c1.scope
node-MainThread  -> /user.slice/user-1000.slice/session-c1.scope
vivaldi-bin      -> /user.slice/user-1000.slice/session-c1.scope
```

systemd-oomd kills at **cgroup** granularity, so its only available move is to kill that
entire scope — i.e. log you out. earlyoom is **process**-granular and kills the single
largest offender. If sway were ever moved under a proper systemd user session (each app in
its own `app.slice` unit), systemd-oomd would become the better choice and this decision
should be revisited.

## Thresholds

```
-M 2621440,1310720    SIGTERM at 2.5 GiB available RAM, SIGKILL at 1.25 GiB
-S 6291456,3145728    SIGTERM at 6 GiB free swap,       SIGKILL at 3 GiB
```

**Both** conditions must hold, which is the point — see the two sections above. It fires only
under genuine exhaustion, and it fires while there is still memory left to run the kill.

`--prefer` targets what actually caused the 2026-07-28 incident: node, bun, claude, electron.
**The browsers are deliberately not in that list any more.** Chromium already self-marks its
renderers `oom_score_adj=300`, so they nominate themselves — the Aug 04 log shows them at
`oom_score 1170`. Adding `chromium|vivaldi-bin` to `--prefer` multiplied that a second time
and pinned earlyoom onto exactly the processes whose RSS overstates the win by 2x, which is
what made a single trigger become a 177-kill loop. Without them, earlyoom can reach the big
single-tenant heaps (node/claude/tsserver) where RSS ≈ PSS and one kill actually clears the
threshold. Renderers stay very killable through their own `oom_score_adj`; they just no
longer outrank a 3 GiB tsserver.

`--avoid` protects session and system plumbing (systemd, sway, kitty, pipewire, dbus, sshd)
so a kill is survivable instead of a logout.

Names match against `comm`, **max 15 chars** — `node-MainThread` is exactly 15,
`systemd-journal` is the truncation of `systemd-journald`.

## Capping tsserver (`~/.local/bin/typescript-language-server`)

TypeScript language servers are a top-3 memory family on this box and they are uncapped by
default. tsserver's heap ceiling comes from typescript-language-server's `maxTsServerMemory`
initializationOption, which only the **LSP client** can send — `typescript-language-server
--help` exposes just `--stdio`, `--log-level` and `--version`, so there is no CLI equivalent.

Of the three clients here, only one could set it:

| client   | how it spawns tsserver                                  | capped by                             |
| -------- | ------------------------------------------------------- | ------------------------------------- |
| `nvim`   | `vtsls`, own init_options                               | `packages/nvim` (was 8192 → now 3072) |
| `claude` | `typescript-language-server --stdio`, no config surface | the shim                              |
| `helix`  | `languages.toml` entry with no `config` block           | the shim                              |

The shim prepends `NODE_OPTIONS=--max-old-space-size=3072` and execs the real binary.
`NODE_OPTIONS` is inherited by the child _node_ process that typescript-language-server
forks for tsserver, so the ceiling lands on the process that actually holds the program
graph rather than on the thin LSP shim in front of it.

3 GiB is >2x the measured steady state (1.29 and 1.15 GiB across two live servers on
2026-08-05). Hitting the cap costs a reindex, not work: tsserver exits and the client
respawns it. `dot sgc` already classifies these as family `typescript-lsp` and reports
combined heap ceilings.

Removing it is one command — `rm ~/.local/bin/typescript-language-server`. The pacman binary
at `/usr/sbin/typescript-language-server` is untouched and takes over immediately.

## Notifications

`oom-notify` follows the journal and fires `notify-send -u critical -t 0` on kernel OOM
kills, earlyoom kills, and systemd-oomd kills. Storms are **coalesced, never suppressed** —
one popup replaced in place, carrying a running count. See "Coalescing, not throttling"
below for why the original 15 s throttle was removed.

The red-and-persistent part is **mako's** job, not this script's — the live notification
daemon here is `mako` (pid 5847), not swaync, even though swaync is installed and registers
a D-Bus service file. `packages/mako` therefore carries the styling:

```ini
[urgency=critical]
background-color=#801420ff
border-color=#f7768e
border-size=3
default-timeout=0        # never expires
ignore-timeout=1         # ... even if the sender asks for a timeout
```

`mako` is in earlyoom's `--avoid` list for the obvious reason: killing the notification
daemon would silence exactly the warning you set this up for.

### ⚠️ This machine runs two D-Bus session buses

Found while testing, and it affects far more than this package:

| bus                  | who is on it                                      |
| -------------------- | ------------------------------------------------- |
| `/tmp/dbus-XXXXXXXX` | sway, **mako**, every terminal you open           |
| `/run/user/1000/bus` | the **systemd user manager** → every user service |

sway is launched under a private bus (`dbus-run-session`), so `org.freedesktop.Notifications`
is only owned on _that_ bus. A `notify-send` from any systemd user service therefore fails
with `NameHasNoOwner`, and D-Bus "helpfully" activates a **second** mako to serve the user
bus — two daemons, two layer-shell surfaces, and `makoctl` from a terminal talking to the
wrong one so you cannot even dismiss the popup.

`oom-notify` works around this by reading `DBUS_SESSION_BUS_ADDRESS` out of the running
daemon's `/proc/<pid>/environ` and sending on _that_ bus. Discovery is the primary path, not
a fallback, precisely so activation never fires. It re-discovers per event, because this unit
reaches `default.target` before sway has started mako and the address changes every login.

**The real fix is upstream of this package**: stop giving the sway session its own bus, so
graphical apps and systemd user services share `/run/user/1000/bus`. Until that happens, any
user service that wants to notify needs the same workaround. Do **not** "fix" it by masking
`mako.service` — that removes the activation fallback and produces total silence.

### Coalescing, not throttling

An earlier version dropped events within 15 s of the previous one, which silently swallowed
real kills — four test events 7.6 s, 2.3 s and 4.2 s apart produced exactly **one**
notification. Every event now sends; bursts replace one popup in place via
`x-canonical-private-synchronous` and the body carries a running count. An OOM kill is the
last thing that should ever be silently discarded.

It is a **user** service because `notify-send` needs the session D-Bus — reaching that from a
root daemon is fragile, which is why earlyoom's own `-n` is not used. It can read the kernel
journal via the ACL on `/var/log/journal` (group `wheel`).

Test it without causing a real OOM:

```sh
systemd-cat -t kernel echo 'Out of memory: Killed process 1 (canary)'
```

## Gotcha

`OOMScoreAdjust` is applied when a unit **starts**, so the currently-running `user@1000`
keeps the inherited `100` until your next login or reboot. Check with:

```sh
cat /proc/$(pgrep -u "$USER" -x systemd | head -1)/oom_score_adj   # want 0, not 100
```

## Related

`packages/swap` (real capacity), `packages/zram` (compressed tier + the early-boot symlink
hazard), and the "Early boot" section of `/data/ops/CLAUDE.md`.
