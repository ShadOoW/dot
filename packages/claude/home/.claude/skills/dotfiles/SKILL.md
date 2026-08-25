---
name: dotfiles
description: |
  How machine configuration is owned on this host: every dotfile lives in a package in
  /data/config/dot and is symlinked into $HOME, never written there directly. Covers the
  package layout (home/, system/, etc-real/), the `dot pkg <package> <action>` CLI, host
  and OS targeting in meta.json, the early-boot symlink hazard, configure.sh, and the
  format/check gates.
  Use when creating or editing ANY config file, dotfile, rc file, or anything under
  ~/.config or $HOME on this machine; when a config "does not take effect"; when adding a
  new tool that needs configuration; when a package must apply to only some hosts or only
  one OS; when something is read at early boot; and before committing to /data/config/dot.
---

# dotfiles

Machine configuration is a **repo**, not a pile of files in `$HOME`. `/data/config/dot`
owns it; `$HOME` holds symlinks into it. The rule that matters:
**never write a config file directly into `$HOME` or `~/.config`.**

The short version is loaded into every session as `DOTFILES.md`. This skill is the detail.

## Why, concretely

A real file in `$HOME` is invisible to the repo. It is not committed, not on the other
host, not in the backup set, and it is silently replaced the next time the package is
linked. `dot pkg <pkg> link` **refuses** to overwrite a non-symlink — when it refuses, it
is telling you the file should have been written into the package.

## Layout

```
packages/<pkg>/
  home/<path relative to $HOME>     → symlinked into $HOME
  system/{base,systemd,runit}/…     → symlinked into /
  etc-real/etc/…                    → COPIED to /etc by configure.sh (never symlinked)
  meta.json                         → description, deps, tags, os, hosts, cleanSteps
  configure.sh                      → anything linking cannot express
  README.md                         → why this package exists and what is load-bearing
```

`~/.config/foo/config` ⇒ `packages/foo/home/.config/foo/config`. Only `home/` and
`system/` are walked by the linker, so anything in `etc-real/` is *structurally*
impossible to symlink — that is the point.

## CLI — package first, action second

```sh
dot pkg <pkg> [action]      # action defaults to info
dot pkg <pkg> link          # NOT `dot link <pkg>` — that form does not exist
dot pkg --tag <tag> link    # every package with a tag
dot pkg --all link          # every package valid for this host and OS
dot pkg status              # symlink health, all packages
dot doctor                  # broken symlinks, drift, ghosts, services
```

Actions: `info`, `link`, `unlink`, `status`, `configure`, `enable`, `disable`.
`link` refuses a real file (use `--force` only when you are certain) and refuses a real
directory even then.

## Host and OS targeting — packages are shared

These packages serve an **Arch desktop, a Void boot, and a macOS laptop**. A package with
no `os` gets linked onto hosts that cannot use it.

```json
{
  "description": "one line, what and why",
  "packages": {
    "arch": { "pacman": ["foo"] },
    "void": { "xbps": ["foo"] },
    "macos": { "brew": ["foo"] }
  },
  "tags": ["wayland"],
  "os": ["linux"],
  "cleanSteps": []
}
```

`"os"` takes `linux` / `macos`; `"hosts"` narrows further by hostname. A restricted
package is **skipped with a message**, not failed — so `dot pkg --all link` stays usable
everywhere. Verify with `dot pkg <pkg> info`, which prints the OS it resolved.

## The early-boot hazard

`/data` is a btrfs subvolume mounted at `local-fs.target`. Anything read **before** that —
systemd generators, `systemd-modules-load`, `systemd-vconsole-setup`, unit drop-ins under
`/etc/systemd/system` — sees a symlink into `/data` as *absent* and continues without
complaint. Cost of record: a 9-day silent swap outage and a console font that never
applied.

Such files go in `etc-real/` and are installed as real copies by `configure.sh`. When
installing, `rm -f` the destination first: `cp`/`install` onto a symlink follows it and
overwrites the file **inside the repo**.

Under runit the ordering hazard does not apply (fstab is mounted before `runsvdir`), but
runit discards stderr and has no journal, so any service shipped for it needs
`exec 2>&1` and its own `log/run`.

## Before you commit

```sh
cd /data/config/dot && just format && just check
```

`check` runs stylua, `shfmt -i 2 -ci`, ruff, prettier over `**/*.{json,md,css}`, taplo and
kdlfmt. Shell `case` branches must be indented; markdown and JSON must be prettier-clean.

## Trust the CLI over the prose

`AGENTS.md` documented `dot link <pkg>` long after the CLI had moved to
`dot pkg <pkg> link`, and an agent followed the doc into `~/.config`. `WATCHDOG.md` exists
because this class of drift recurs. Check `dot <cmd> --help`, then fix the stale prose in
the same commit.
