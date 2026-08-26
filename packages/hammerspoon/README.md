# hammerspoon

macOS-only (`meta.os = ["macos"]`, so `dot pkg --all link` skips it on the Linux hosts).
Runs on the MacBook and does one job: **every copy on the Mac lands in the desktop's
cliphist history**, so it is waiting under `mod+c` with no keystroke.

| File                                  | Role                                                                  |
| ------------------------------------- | --------------------------------------------------------------------- |
| `home/.hammerspoon/init.lua`          | decides _when_ to sync (changeCount poll) + the manual promote hotkey |
| `home/.hammerspoon/clipboard-sync.sh` | does the work: spool a copy, push the queue over SSH                  |

The Linux end is the `cliphist` package; the picker is `packages/fuzzel`
(`fuzzel-scripts/clipboard.sh`) and the local watcher is in `packages/sway`
(`.config/sway/exec`).

## How it works

`init.lua` polls `hs.pasteboard.changeCount()` once a second — a cheap integer read that
needs **no macOS permission at all** (no TCC prompt, no Accessibility; only the hotkey
needs Accessibility). On a change it runs `clipboard-sync.sh sync`, which snapshots the
pasteboard into a spool file and then pushes the queue to the desktop over the tailnet:

```
pbpaste > spool/<epoch>.clip   →   ssh desktop 'cliphist … store'   →   mod+c
```

A separate 30-second timer runs `flush` alone, to drain the spool after the desktop has
been unreachable.

## Three things that are load-bearing, not style

- **The clipboard bytes never pass through Lua.** `hs.task:setInput()` re-decodes UTF-8 as
  MacRoman — measured, `✓ café` arrived as `‚úì caf√©`. `pbpaste` writes the spool file
  and the shell feeds it to `ssh`, so Hammerspoon never sees the bytes.
- **`-max-items` is mandatory on every `cliphist store`.** It trims the db to that number
  on every store and the CLI default is **750**, against a database of thousands that is
  kept forever. See `packages/cliphist/README.md`.
- **The spool is what makes it durable.** Copy something with the desktop asleep and the
  clip is queued, not lost; it lands on the next flush. Only a confirmed store deletes a
  spool file, and the loop stops at the first failure so ordering survives.

- **Hammerspoon reads its config once, at launch, and never re-resolves the symlinks.**
  Relinking this package — or moving the payload out from under it — does not reload a
  running instance; the poll keeps firing against the paths it captured at startup and the
  sync goes silently stale (measured 2026-08-26 after the payload moved from `~/code/dotfiles`
  to `~/code/dot`). After `dot pkg hammerspoon link` or any payload move, restart it:
  `osascript -e 'tell application "Hammerspoon" to quit' && open -a Hammerspoon`.

## What is deliberately not synced

- **Images and other non-text flavours.** `pbpaste` renders no text for them, and an
  empty capture is skipped rather than stored as a blank clip.
- **The desktop's live selection.** Automatic sync only writes _history_; it would
  otherwise stomp whatever you are copying on Linux. Use the hotkey when you want the
  Mac clipboard to become the live selection.

## Hotkey

`Ctrl+Option+Shift+V` promotes the Mac clipboard to the desktop's live selection
(`wl-copy`), so `Ctrl+V` in the stream pastes it immediately. It reuses the keystroke
Moonlight assigns to its own paste, which is a no-op against this host — Hammerspoon
consumes the combo so Moonlight's dead path never fires. If Moonlight is fullscreen with
keyboard grab active it may swallow the combo first; `Ctrl+Alt+Shift+K` toggles that grab.

## Checking on it

```sh
ls ~/.cache/clipboard-sync/          # queued clips; empty is healthy
sh ~/.hammerspoon/clipboard-sync.sh flush   # force a drain, see the error
```

One alert fires after 10 consecutive failed pushes and then stays quiet — failures are
normally transient and self-healing, but a permanently broken sync should not be silent.
