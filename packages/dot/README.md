# dot

The fresh-host bootstrap, in its own package.

The one thing a host needs before any command exists: a way to say where the kit was
cloned. Everything that actually dispatches commands — `dot` among them — lives in
`packages/logos`'s shared launcher (logos 13); this package holds only `bootstrap.sh`,
which has no dependency on `dot` or on anything being linked yet.

## Two repositories

The payload — `packages/`, `pkgbuilds/`, `docs/` — is this repo. The TypeScript is in the kit
(`apps/dot`, `apps/brucelee`, …), a different repository, cloned somewhere different on each
host. Neither tree can name the other, which is why `bootstrap.sh` resolves everything by
path rather than spelling one out.

## A new host

```sh
git clone git@github.com:ShadOoW/dot.git            # this repo, the payload
git clone git@github.com:shadhq/logos.git           # the kit
cd logos && bun install --filter '@app/dot' --filter '@kit/*'

cd ../dot
packages/dot/bootstrap.sh ../logos   # records where the kit is, links every command
dot doctor
```

The one recorded fact is `${XDG_STATE_HOME:-~/.local/state}/dot/logos-root`. `LOGOS_ROOT`
overrides it for a run against a branch, or for pointing a command at another machine's
checkout over a mount. After adding or removing a command's declaration, `dot pkg logos
configure` re-reads the manifests and updates the links — `bootstrap.sh` is only for the
first host.
