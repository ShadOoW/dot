# Session snapshots

Every open terminal, the coding-agent conversations inside them, and the sway layout
holding them — saved as data and put back later. Implemented as
[`dot session`](../src/commands/session/), with the pieces in
[`src/lib/session.ts`](../src/lib/session.ts) (capture and restore planning),
[`agents.ts`](../src/lib/agents.ts), [`session-select.ts`](../src/lib/session-select.ts),
[`session-slots.ts`](../src/lib/session-slots.ts) and
[`sway-layout.ts`](../src/lib/sway-layout.ts).

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
dot session restore               # picker over the saved slot
dot session restore --from bruce --all
dot session restore --pick        # fuzzel slot menu ($mod+o)
dot session recover               # sessions from before this boot, newest first
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

Two mechanisms, one adapter table ([`agents.ts`](../src/lib/agents.ts)), so adding an
agent is a data change:

| agent    | live session id                                                                                       | resume                                 |
| -------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `claude` | `<configDir>/sessions/<pid>.json` registry, guarded against PID reuse by `/proc/<pid>/stat` starttime | `claude-work\|-personal --resume <id>` |
| `omp`    | **open fd**: the live process holds its transcript open and the path carries the uuid                 | `omp -r <id>`                          |

The account comes from `CLAUDE_CONFIG_DIR` (`~/.claude-work` → `claude-work`), so a session
resumes in the config dir it belongs to.

**Detection matches the basename of any argv element, never just argv[0].** Only `claude`
ships as an ELF binary; every other agent is a JS entrypoint, so a live `omp` appears as
`bun /home/shad/.bun/bin/omp`. An argv[0] test silently demotes it to a generic command,
and restore then "restores" it by re-running that argv — a fresh agent with an empty
context, reported as success. That bug is what the adapter table exists to prevent.

## Unexpected shutdown

Agents are resumable by nature; shells and dev commands are not worth recovering. So the
crash story only has to be good for agents — and for agents the evidence survives on disk.

```
~/.omp/agent/sessions/--data-config-dot--/2026-08-09T16-19-04-076Z_<uuid>.jsonl
~/.claude-work/projects/-data-config/<uuid>.jsonl
```

`dot session recover` derives boot time from `btime` in `/proc/stat` and offers every
session whose transcript predates it, **most recent first**. Candidates go through the
ordinary picker and the ordinary restore path — recovery synthesises a manifest of
windowless agents rather than growing a parallel pipeline. No daemon, no state of its own,
and it still works when a daemon would itself have been dead.

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
dot session restore --if-pending && dot session recover --notify &
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
that this does not: detach/reattach over SSH. Continuous auto-save is deliberately absent —
an event-driven daemon writing to an `auto` slot is the sanctioned upgrade path if the
`recover` heuristic ever proves too coarse, and a periodic timer is explicitly rejected as
strictly worse (staler _and_ more wakeups).
