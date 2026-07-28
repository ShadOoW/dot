# oom — memory safety

Minimal setup so **the system itself never runs out of RAM**, and so an OOM kill is never
silent. Three parts, deliberately no more.

```sh
dot link oom            # user unit + ~/.local/bin/oom-notify
dot pkg oom configure   # earlyoom, /etc drop-ins, enable everything
```

| Part                               | Does                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| `earlyoom`                         | kills the largest offending **process** before the kernel's blunt killer runs |
| `system.slice` `MemoryMin=1G`      | a floor of memory the kernel will not reclaim from system services            |
| `user@.service` `OOMScoreAdjust=0` | stops the kernel preferring your session manager over the real hog            |
| `oom-notify.service`               | red, non-expiring notification on any OOM kill                                |

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

`-m 10,5 -s 10,5` — SIGTERM at 10 % free, SIGKILL at 5 %, of **both** memory and swap. With
zram (23 GiB) plus the NVMe swapfile (16 GiB, see `packages/swap`) behind it, this only fires
under genuine exhaustion, and it fires while there is still memory left to run the kill.

`--prefer` targets what actually caused the incident (node, bun, claude, chromium, electron).
`--avoid` protects session and system plumbing (systemd, sway, kitty, pipewire, dbus, sshd)
so a kill is survivable instead of a logout.

Names match against `comm`, **max 15 chars** — `node-MainThread` is exactly 15,
`systemd-journal` is the truncation of `systemd-journald`.

## Notifications

`oom-notify` follows the journal and fires `notify-send -u critical -t 0` on kernel OOM
kills, earlyoom kills, and systemd-oomd kills. Storms are throttled to one popup per 15 s
with a `(+N more suppressed)` tail.

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
