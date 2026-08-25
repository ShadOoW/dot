# Config files (machine-wide, all projects)

**Never create or edit a config file directly in `$HOME` or `~/.config`.** On this machine
every dotfile is owned by a package in `/data/config/dot` and reaches `$HOME` as a
**symlink**. Writing the real file works today and is silently lost the next time the
package is linked, backed up, or moved to another host. Full detail: skill `dotfiles`.

1. **Find or create the package.** One package per app:
   `/data/config/dot/packages/<pkg>/home/<path-relative-to-$HOME>`. So a config that
   belongs at `~/.config/foo/config` is written to
   `packages/foo/home/.config/foo/config`. Packages are discovered by directory scan —
   there is no registry to update.
2. **Link it.** `dot pkg <pkg> link` — **package first, action second**. `dot link <pkg>`
   does not exist. Other actions: `info`, `unlink`, `status`, `configure`, `enable`.
   `link` refuses to overwrite a real file, which is the safety net telling you that you
   wrote to `$HOME` when you should have written to a package.
3. **Declare where it may run.** `packages/<pkg>/meta.json` carries
   `"os": ["linux"]` / `["macos"]` / both, plus optional `"hosts"`. These packages are
   shared by an Arch desktop, a Void boot and a macOS laptop, so an undeclared package
   gets linked onto a host that cannot use it. A restricted package is skipped, not failed.
4. **Anything read before `local-fs.target` is a real file, never a symlink.**
   `/data` is not mounted that early, so a symlink there resolves to nothing and the
   consumer treats the config as absent — this cost a 9-day silent swap outage. Those
   files live in the package's `etc-real/` and are installed by its `configure.sh`.
   Applies to systemd generators, `modules-load.d`, `vconsole.conf`, and unit drop-ins
   under `/etc/systemd/system`.
5. **Before committing:** `just format && just check` in `/data/config/dot`.
6. **Verify, do not assume:** `dot doctor` reports broken symlinks, drift and ghosts;
   `dot pkg <pkg> status` checks one package. A config you "installed" that `dot doctor`
   does not know about is not installed.

**The repo's own docs have been wrong before.** `AGENTS.md` documented `dot link <pkg>`
long after the CLI moved to `dot pkg <pkg> link`, and an agent followed it into
`~/.config`. Trust `dot <cmd> --help` over any prose, including this file, and fix the
prose in the same commit.
