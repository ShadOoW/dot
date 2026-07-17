# Project workspaces & session snapshots

How per-project sway workspaces get built, and how every open terminal — including
running Claude Code sessions — survives a reboot. Implemented as
[`dot tools workspace`](../src/commands/tools/workspace.ts) and
[`dot claude session`](../src/commands/claude/session.ts), configured through
[`packages/sway`](../packages/sway/).

## The annoyance that started this

A working project workspace here is always the same shape: a sway **tabbed
container** on the left holding heterogeneous apps (Claude Code in kitty, Insomnia,
sometimes a second claude), and a single kitty on the right using **kitty tabs** for
dev tasks (`npm run debug`, `bun cli.ts dev`, a git shell). It was rebuilt by hand
every single time.

Worse: a reboot destroyed all open Claude sessions. Getting one back meant
remembering which project it lived in, digging up the session id, and running
`claude --resume <uuid>` per session — annoying enough that reboots got postponed.
The fix leans on something Claude Code already maintains: a live registry of every
interactive session at `<config-dir>/sessions/<pid>.json`, carrying its `sessionId`,
`cwd`, and tab `name`. There is one registry per account — `~/.claude-work`,
`~/.claude-personal`, and the bare `~/.claude` backup — so the dir a session lives in
also tells us which account (and hence which `claude-*` launcher) resumes it. Nobody
needs to remember session ids or accounts — they are sitting on disk, keyed by live PID.

## Workspace launcher

Profiles live in `~/.config/dot/workspaces.json`
([`packages/sway/home/.config/dot/workspaces.json`](../packages/sway/home/.config/dot/workspaces.json)):

```jsonc
"bruce": {
  "path": "/data/code/work/bruce",
  "workspace": 3,                       // or "current"
  "left": [
    { "name": "claude", "kind": "kitty", "cmd": "claude-work" },
    { "name": "api", "kind": "app", "exec": "insomnia", "appId": "insomnia" }
  ],
  "right": {
    "widthPpt": 50,
    "tabs": [
      { "title": "debug", "cmd": "npm run debug", "cwd": "app/client/web/code" },
      { "title": "git" }                // no cmd → plain shell at `path`
    ]
  }
}
```

- `left` members become sway tabs. `kind: "kitty"` windows get a synthetic
  `--app-id ws-<profile>-<name>`; `kind: "app"` members need their real Wayland
  `appId` so the launcher can find the window (`insomnia` is verified). Single-instance
  apps that refuse to open a second window are simply adopted from wherever they are.
- `right.tabs` become kitty tabs via a generated `kitty --session` file. Commands run
  through `zsh -l -c '<cmd>; exec zsh -l'` — login-shell PATH, and a crash drops to a
  shell instead of closing the tab.
- Launch: `dot tools workspace bruce`, or `$mod+o` for the fuzzel picker
  (`$projects` in [`packages/sway` variables](../packages/sway/home/.config/sway/variables)).
- Re-running a profile **focuses** the existing workspace instead of duplicating it —
  detection is by the `ws:<name>:left` container mark and `ws-<name>-*` app_ids.

The orchestration talks to sway over its IPC socket directly
([`src/lib/sway.ts`](../src/lib/sway.ts)): subscribe to window events _before_
spawning, wait for each app_id, then `move container to mark` into the tabbed
container. Because scripted layouts and autotiling fight each other, workspaces
**3/4 are excluded from autotiling-rs** (see
[`packages/sway` exec](../packages/sway/home/.config/sway/exec)) — put project
profiles there.

## Session snapshot: reboot without losing anything

```
dot claude session reboot         # snapshot everything, confirm, reboot
dot claude session save           # snapshot only (manual)
dot claude session status         # what's pending
dot claude session restore --dry-run
```

`reboot` walks every kitty instance (`kitten @ ls` per `/tmp/kitty-*` socket),
records each window's **cwd + foreground command + sway workspace**, and joins claude
windows against the live session registry. The join is by claude's own **PID** (the
key Claude Code writes its registry under), falling back to `KITTY_LISTEN_ON` +
`KITTY_WINDOW_ID` then a unique cwd; PID reuse is guarded by `/proc/<pid>/stat`
starttime. Each claude window is tagged with the **account** its process runs under
(read from `CLAUDE_CONFIG_DIR`), so it resumes in the right config dir. The manifest
lands in `~/.local/state/dot/session/manifest.json`, then the machine reboots.

On the next sway login, `dot claude session restore --if-pending` (in the sway `exec` block)
claims the manifest **atomically by rename** — restore fires exactly once, even if it
crashes halfway — and rebuilds each kitty os-window on its saved workspace:

- claude windows → `claude-work` / `claude-personal --resume <sessionId>` (right
  account, exact session, exact cwd)
- dev commands → re-run verbatim
- plain shells → reopened at their cwd

Deliberate cuts and edge rules:

- **GUI apps are not restored** (Insomnia, browser, …). Vivaldi restores itself from
  the autostart line; project GUIs come back with `dot tools workspace <name>`. The
  reboot summary lists what will be skipped.
- The pre-warmed scratchpad kitties (`terminal-mark`, `music-mark`, `yazi-explorer`)
  are excluded — sway's exec block recreates them anyway.
- A claude window whose session id can't be resolved falls back to `<launcher> -c`
  (continue newest for that cwd, in that window's account), but **only** when it is
  the only id-less claude in that cwd — two `-c` in one directory would race for the
  same session. Extra registry sessions with no window get their own `session-claude`
  window.
- Snapshots are explicit by design: only `reboot`/`save` write a manifest, so a
  normal login never restores anything you closed on purpose. **Exactly one snapshot
  is kept** — restore consumes it, and the next `save`/`reboot` overwrites it. No
  history.

## Replacing tmux

The combination is the tmux workflow without tmux: kitty tabs/splits are the
multiplexer, sway tabs group heterogeneous apps per project, `dot tools workspace`
is the session definition, and `dot claude session` is tmux-resurrect. What tmux still does
that this doesn't: surviving _unplanned_ deaths (power loss) — the snapshot is
explicit, not continuous — and detach/reattach over SSH.
