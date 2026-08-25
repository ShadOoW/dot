# cliphist

Clipboard history for the Wayland session. This package ships **only the config**; the
moving parts live in two other packages, which is worth knowing before changing anything:

| Piece                          | Lives in                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------ |
| Watcher that stores every copy | `packages/sway/home/.config/sway/exec` (`wl-paste --watch cliphist … store &`) |
| Picker bound to `mod+c`        | `packages/fuzzel/home/.config/fuzzel-scripts/clipboard.sh`                     |
| Config (this package)          | `home/.config/cliphist/config`                                                 |
| Read-only ingest into the lake | `/data/ops/lake` via `CLIPHIST_DB`                                             |

The database is `/data/stash/clipboard/cliphist` (BoltDB, single bucket `b`, keys are a
monotonic entry id). It is **kept forever** — never truncate it, never wipe it.

## The hazard this config exists to prevent

`cliphist store` trims the db to `-max-items` on **every store**, and the CLI default is
**750**. The db held 8,549 entries when this was written. So:

```sh
cliphist -db-path /data/stash/clipboard/cliphist store   # WITHOUT -max-items
```

would have silently destroyed 7,799 entries. Nothing warns, and the loss is not
recoverable from the db itself.

Pinning `db-path` and `max-items` in the config makes the safe values the default for
every invocation, so a forgotten flag is no longer destructive. Explicit flags still win,
so any caller that passes `-max-items` must keep it `>=` the config value.

Note `cliphist` has **no metadata capability at all** — verbs are
`store|list|decode|delete|delete-query|wipe|version` and the payload is raw bytes with no
room for a timestamp or a source field. Anything provenance-shaped has to live outside it
(the lake stamps `host` and `ingested_at` at ingest time).

## macOS clipboard sync

Copies made on the Mac are pushed into this db automatically, so they show up under
`mod+c` like any local copy. That runs on the laptop, not here — see
`packages/hammerspoon`.

## Backups

`/data/stash/clipboard/backups/` holds timestamped copies. Verify one before trusting it:

```sh
cliphist -db-path /data/stash/clipboard/backups/cliphist.<stamp> list | wc -l
```
