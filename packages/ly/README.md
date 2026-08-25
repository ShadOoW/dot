# ly - Display Manager

ly is **built from source**, not installed from a repository. `/data/code/fleet/apps/dot/src/lib/updaters/ly.ts` clones
`codeberg.org/fairyglade/ly`, builds it with anyzig and installs the resulting DESTDIR tree.
`meta.json` therefore declares only the link dependencies (`pam`, `libxcb`) — Void has no `ly`
package at all, and Arch's would fight the build (see below).

Order on a fresh machine:

```sh
dot install ly       # pam + libxcb
dot pkg ly link      # /etc/ly/login.sh, /etc/environment
dot update source    # builds and installs ly itself
dot pkg ly configure # points login_cmd at /etc/ly/login.sh
```

`dot update source` seeds `/etc/ly/config.ini` only when it is missing, so `configure.sh` has
something to patch on a first install and your edits survive every later update.

## Why not Arch's `ly` package

It installs the binary as `ly-dm` yet claims 28 of the same paths the source build writes —
`/usr/lib/systemd/system/ly@.service`, `/etc/pam.d/ly`, all of `/etc/ly/lang/` — so with both
present pacman and `dot update` overwrite each other on every run, and `ly@.service` flips its
`ExecStart` between `/usr/bin/ly-dm` and `/usr/bin/ly` depending on who wrote last. The updater
removes the package when it finds it and re-checks on every run, so `pacman -S ly` cannot
quietly reintroduce the split.

The binary is built `ReleaseSafe`. Debug is not merely slower here: a native x86_64 Debug build
uses zig's self-hosted linker, which cannot relocate `R_X86_64_PC64` in the `.sframe` section
GCC 16 emits into `crt1.o`, and the link fails outright.

Nothing in this build runs as root — the DESTDIR tree is staged in `~/.cache/dot/ly-stage` and
copied into place. `sudo zig build` in the source tree used to leave root-owned objects in
`.zig-cache` that broke every later unprivileged build with
`unable to load 'install.zig': AccessDenied`; the updater clears that fallout if it sees it.

## Notes

disable agetty-tty2

## Clean

- ln -s /etc/sv/agetty-tty2 /var/service/agetty-tty2 # restore if needed
