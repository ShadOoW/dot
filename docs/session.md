# Session snapshots

Every open terminal, the coding-agent conversations inside them, and the sway layout
holding them — saved as data and put back later. Implemented as
`dot session` (`/data/code/fleet/apps/dot/src/commands/session/`), with the pieces in
`/data/code/fleet/apps/dot/src/lib/session.ts` (capture and restore planning),
`agents.ts`, `session-select.ts`, `session-slots.ts` and
`sway-layout.ts` (all under `/data/code/fleet/apps/dot/src/lib/`).

## Why it is called `session`

Because that is what the rest of the world calls it: an X11/Wayland **session manager**
saves and restores the set of running apps, and systemd already calls your login a session
(`XDG_SESSION_ID=c1`). The word is overloaded three ways in this repo — the desktop
session, an agent's conversation, and kitty's own `--session` files — so the rule is:

> Bare "session" means the **desktop** session. An agent's conversation is **always**
> qualified: "agent session", or its id.

The selector namespace enforces it for free, because you type `--only agent`.

## Commands

```
dot session save                  # picker, everything preselected
dot session save --all            # no picker
dot session save --only agent     # picker, prefiltered to agent windows
dot session save --only agent:omp --all
dot session reboot                # snapshot, confirm, reboot
dot session save --autosave       # the timer's save: autosave series, arms nothing
dot session restore               # picker over the saved slot
dot session restore --from bruce --all
dot session restore --pick        # fuzzel slot menu ($mod+o)
dot session restore --from autosave --all   # the newest periodic autosave
dot session recover               # sessions from before this boot or sway restart
dot session recover --within 30   # narrow to just before the machine stopped
dot session list                  # slots, with per-type counts
dot session status                # what is armed
dot session clear [slot]
```

Two flags, one rule that holds for every verb: **`--only` narrows, `--all` skips the
picker.** They compose — `--only agent --all` saves every agent window without prompting.
`--except` is the inverse of `--only`. Without a TTY the picker refuses to prompt (the same
guard `dot cue` uses) and prints the rows plus the `--only` string that would select them.

## The picker

One `groupMultiselect` widget expresses all three of "everything", "by type", and
"individual windows", because a group header is itself a selectable row and one space on it
toggles every child:

```
◆  Save which windows?
│  ◼ agent:omp (2)
│    ◼ ~/config/dot        resume 019fe752
│    ◼ /data/lake          resume 019fe0ee
│  ◼ agent:claude-work (2)
│    ◼ /data/ops           continue newest — no id
│    ◻ /data/ops         ! plain shell — 2 id-less here
│  ◼ command (1)
│    ◼ ~/config/dot        watch -n 1 sudo smartctl -A /dev/nvme0
│  ◼ shell (6)
│  ◻ app (3)
└  space toggles · enter saves
→ dot session save --all --only agent:omp,command
```

- Groups are agent **flavour**, not just `agent`, so "every omp session" is one keystroke.
  A flavour is always the resume launcher (`claude-work`, `omp`), never the adapter id.
- Everything starts ticked **except `app`**, so Enter means "save it all" and the picker is
  subtraction rather than construction. GUI apps are opt-in because relaunching arbitrary
  GUI argv is the riskiest thing here.
- Each row carries the verdict **restore would actually produce** — computed from the same
  `buildRestorePlan` logic before you commit, not reported afterwards. `!` marks a window
  that cannot come back.
- An interactive save echoes the equivalent command, so the picker teaches the flags.

## Slots

A save always writes the **complete** capture to `last`, and additionally writes a named
slot when the save was partial or `--as` was given. That double write costs ~2 KB and
removes the entire class of "my full snapshot was clobbered by a partial save". The
**named** slot is the one armed for login, so what you picked is what comes back.

**Autosaves are a separate, smaller series.** `save --autosave` writes the complete capture
to `autosave.<time>` (`autosave` names the newest), keeps only the last **3**, dedupes an
unchanged desk exactly as the history does, skips an empty desk, and arms nothing. Kept
apart because a timer saves far more often than a person: in the 20-deep history, ten
minutes of an ordinary afternoon apiece would push every deliberate save — the one a
reboot or a sway stop took — out within hours. Unarmed because a login restores what
someone chose to save, not whatever the timer last saw. On the NixOS desk
`sway-autosave.timer` (punk-records `hosts/desktop`) runs it every 10 minutes, first at
10 minutes into the session so it never captures a login restore half-done.

Slot names are derived, never prompted: `agent:omp` → `agent-omp`,
`agent:omp,command` → `agent-omp+command`.

**A slot is a project layout obtained by demonstration.** Arrange the workspace by hand
once, `dot session save --as bruce`, then `dot session restore --from bruce` forever. This
replaced a declarative `workspaces.json` of hand-authored profiles — which was written
once, launched zero times, and could drift from reality. `$mod+o` now opens a fuzzel menu
over slots.

## What restore rebuilds

- agent windows → `<launcher> --resume <id>` / `omp -r <id>`, in the right account and cwd
- dev commands → re-run verbatim
- plain shells → reopened at their cwd
- GUI apps → `swaymsg exec <argv>`, only when they were ticked at save time
- sway layout → tabbed containers and split ratios, per workspace

Restore is **idempotent**: an `app_id` already on screen is adopted rather than launched
again. That is what makes partial restore safe to reach for, and it is why a second
restore cannot resume a live agent session a second time — two processes appending to one
transcript corrupts it. For the same reason a session id that is currently live is skipped
with a note, and the layout pass only ever touches windows this run actually launched (the
planner is pure and cannot see an existing container, so re-placing an adopted window
would wrap it twice and produce two stacked tab bars).

Adoption is keyed on the app_id a window had **at capture**, so it never spans runs that
captured nothing: the container recovery builds for windowless sessions is named after the
sessions it carries (`session-agents-<id prefix>`), not a fixed `session-agents`. Under the
fixed name a window left over from an earlier recovery was adopted, nothing was launched,
and the run still reported success — two sessions killed by a reboot came back as
"Restored 1/1 windows, 2 agent session(s)" with no omp started for either (2026-09-21).
An adopted window is now counted apart from a launched one in that line.

Edge rules worth knowing:

- An id-less agent window falls back to `<launcher> -c` — continue the newest session for
  that cwd — but **only** when it is the only id-less window of **that agent** in that cwd.
  Keyed on `(agent, cwd)`, not cwd alone: two different agents in one directory read
  different stores and do not compete.
- The pre-warmed scratchpad kitties (`terminal-mark`, `music-mark`, `yazi-explorer`) are
  excluded — sway's exec block recreates them.
- Layout reconstruction stops at depth 3 and falls back to flat placement with a note.
  Deep sway layout restore is unreliable, and a wrong tree is worse than a flat one.
- The layout refers to windows by the **sway con_id they had at capture time**, not by
  app_id. app_id does not identify a window: every bare kitty os-window reports `kitty`,
  so six agent terminals are indistinguishable by it and an app_id-keyed layout could
  never rebuild the one arrangement that matters most. Restore maps each captured con_id
  to the con_id of the window it launched in its place, falling back to app_id for a GUI
  window it adopted rather than launched.

## How agents are found

Two mechanisms, one adapter table (`/data/code/fleet/apps/dot/src/lib/agents.ts`), so adding an
agent is a data change:

| agent    | live session id                                                                                                                                                                                                       | resume                                 |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `claude` | `<configDir>/sessions/<pid>.json` registry, guarded against PID reuse by `/proc/<pid>/stat` starttime                                                                                                                 | `claude-work\|-personal --resume <id>` |
| `omp`    | three signals, most current first: the **open fd** on its transcript (whose path carries the uuid), then the per-terminal breadcrumb in `~/.omp/agent/terminal-sessions/pts-<n>`, then a `-r <id>` in the launch argv | `omp -r <id>`                          |

The account comes from `CLAUDE_CONFIG_DIR` (`~/.claude-work` → `claude-work`), so a session
resumes in the config dir it belongs to.

**Detection matches the basename of any argv element, never just argv[0].** Only `claude`
ships as an ELF binary; every other agent is a JS entrypoint, so a live `omp` appears as
`bun /home/shad/.bun/bin/omp`. An argv[0] test silently demotes it to a generic command,
and restore then "restores" it by re-running that argv — a fresh agent with an empty
context, reported as success. That bug is what the adapter table exists to prevent.

**A kitty instance is recognised by the binary behind its socket pid, never by
`comm == "kitty"`.** Capture enumerates live instances from `/proc/net/unix` and then has
to prove the pid is kitty; on NixOS the process runs through a wrapper and reports
`.kitty-wrapped`, so the equality test rejected every socket on this host. With no
instance found, every terminal was recorded as a plain GUI app and `restore` "restored" it
by re-running `kitty --single-instance --app-id …` — bare shells, no agent, wrong cwd,
reported as success (2026-09-21). `/proc/<pid>/exe` is read first because `comm` is
truncated at 15 bytes.

## Unexpected shutdown

Agents are resumable by nature; shells and dev commands are not worth recovering. So the
crash story only has to be good for agents — and for agents the evidence survives on disk.

```
~/.omp/agent/sessions/--data-config-dot--/2026-08-09T16-19-04-076Z_<uuid>.jsonl
~/.claude-work/projects/-data-config/<uuid>.jsonl
```

`dot session recover` derives boot time as `now - /proc/uptime` and offers every
session whose transcript predates it, **most recent first**. Candidates go through the
ordinary picker and the ordinary restore path — recovery synthesises a manifest of
windowless agents rather than growing a parallel pipeline. No daemon, no state of its own,
and it still works when a daemon would itself have been dead.

**Not `btime` from `/proc/stat`.** The kernel stamps btime once, at boot, from the wall
clock as it stood then, and never revises it, so a host whose RTC is wrong until NTP steps
it keeps the pre-step value all boot long. Measured 2026-09-21: btime claimed 14:08:58 for
a boot at 23:25:38, which sorted the whole evening's transcripts _after_ "boot" — six
sessions the shutdown had just killed were reported as nothing to recover, and the login
hook said nothing. `/proc/uptime` is CLOCK_BOOTTIME and immune to the step.

**The cutoff is the later of the boot and the running sway's start.** A compositor restart
kills every terminal and agent inside it while the container keeps running, and counting
only from the boot made that crash invisible: on 2026-09-24 an OOM kill took sway down a
day into the boot, and every victim's last write came after the boot, so `recover` offered
nothing. sway's start is read as the **mtime of `$SWAYSOCK`**, which sway binds as it comes
up, and not as the pid in the socket's name. sway names the socket after itself only when
SWAYSOCK is unset, and a sway restarted by the user manager inherits the previous one's
path: pid 675110 was serving `sway-ipc.1000.493.sock`.

### Why it does not try to guess what was open

Nothing on disk records that a session was _open_. A transcript's mtime is its last
**activity**, so a session you left idle for an hour looks exactly like one you closed
three days ago. claude's `sessions/<pid>.json` survives an unclean kill and is exact, but
it is claude-only; omp has no pid registry, no session table in `agent.db`, and no terminal
record in its transcript — the record types are all content.

So recovery does not pretend to know. It ranks by recency and lets you choose, because the
errors are not symmetric:

| outcome                         | cost                    |
| ------------------------------- | ----------------------- |
| offers a session already closed | one unticked row        |
| hides a session that was open   | **the session is lost** |

An earlier version cut off 15 minutes before boot, which made anything left idle — a long
build, a session picked up the next morning — silently unrecoverable. Narrow with
`--within <minutes>` when you know roughly when the machine died, and `--limit` (default 25) bounds the list.

**The login notification is the exception and stays narrow** (15 minutes), because it fires
on every boot: a generous list there would mean a popup every time you log in. Interactive
recovery is generous, the notification is conservative, and both read the same evidence.

The project directory names are a **lossy** mangling (`-data-config` cannot be reversed
when a real path contains a dash), so the cwd is read out of the transcript, which records
it.

**Login never auto-restores after a crash.** The one-shot token is armed only by an
explicit `save`/`reboot`, so an unclean boot arms nothing. Rebuilding the desktop behind
your back would race whatever you do first.

### Why the two login hooks are sequenced, not parallel

```sh
( ~/.local/bin/dot session restore --if-pending && ~/.local/bin/dot session recover --notify ) 2>&1 | logger -t dot-session &
```

Transcript mtimes **cannot distinguish an orderly shutdown from a crash** — an agent that
was open writes its last turn just before the machine stops either way. The only thing
that separates them is whether those sessions are live again, and `restore` is what makes
them live: after a planned `dot session reboot` the restored sessions are excluded as
"already running", leaving nothing to report.

That only holds if restore finishes first. Run concurrently, `recover` completes in ~0.1 s
while `restore` is still waiting on windows to appear, so **every planned reboot would
announce itself as a crash**. Hence `&&`.

For the same reason the notification never asserts that anything crashed. It says what the
evidence supports — _N agent sessions were open before this boot and are not running now_ —
and names the command.

### The one-shot token

The manifest holds the layout; a separate zero-byte token is the one-shot "auto-restore on
next login" trigger, claimed by an atomic `rename` so a crash or a racing invocation can
never double-fire. Keeping them separate is what lets slots stay **durable** while
login-restore still fires exactly once: a re-restore, a partial failure or an unplanned
reboot never loses a slot. A manual `dot session restore` disarms the token but keeps the
slot. `dot session status` shows what is armed.

## Replacing tmux

kitty tabs and splits are the multiplexer, sway tabs group heterogeneous apps per project,
a slot is the session definition, and `dot session` is tmux-resurrect. What tmux still does
that this does not: detach/reattach over SSH.

**Periodic autosave, and why the earlier rejection no longer holds.** This section used to
rule out a periodic timer as strictly worse than an event-driven daemon (staler _and_ more
wakeups), with `recover` as the answer to a crash. That weighed the timer against
`recover`'s session list, and on that axis it still loses. The case it was never weighed
against is the one that happened on 2026-09-24: **sway itself dies**. The stop hook then
finds no live compositor and saves nothing, and `recover` can bring back the agent sessions
but not the layout holding them. A capture at most ten minutes old is the only thing that
can, and a 0.15 s capture every ten minutes costs nothing measurable. The staleness is
bounded by the timer, and the series is small enough that none of it outlives its use.
