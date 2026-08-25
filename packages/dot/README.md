# dot

The launcher, in its own package.

It used to live in `packages/zsh`, which meant the CLI that links your packages could only be
put on PATH by linking your shell first. `dot` is not zsh, and on a host where nothing is
linked yet the launcher is the one thing you need before anything else.

## Two repositories

The payload — `packages/`, `pkgbuilds/`, `docs/` — is this repo. The TypeScript is in the kit
(`apps/dot`), a different repository, cloned somewhere different on each host. Neither tree
can name the other, which is why `bootstrap.sh` exists and why `home/.local/bin/dot` resolves
its own symlink instead of spelling out a path.

## A new host

```sh
git clone git@github.com:ShadOoW/dot.git            # this repo, the payload
git clone git@github.com:shadhq/fleet.git           # the kit, the CLI
cd fleet && bun install --filter '@app/dot' --filter '@kit/*'

cd ../dot
packages/dot/bootstrap.sh ../fleet                  # record where the kit is
sh packages/dot/home/.local/bin/dot pkg dot link    # put the launcher on PATH
dot doctor
```

The one recorded fact is `${XDG_STATE_HOME:-~/.local/state}/dot/cli-path`. `DOT_CLI`
overrides it for a run against a branch; `DOT_ROOT` overrides the payload the launcher
derived, which is mostly useful for pointing `dot` at another machine's checkout over a
mount.
