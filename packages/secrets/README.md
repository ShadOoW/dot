# secrets

`~/.config/secrets` is the credential store. One file per provider, named after it, no
extension, mode 600, in a directory that is mode 700. `packages/zsh/home/.zprofile.d/05-secrets.zsh`
sources every file in it at login and exports each `KEY=VALUE` line.

```sh
bash packages/secrets/configure.sh
```

`configure.sh` owns the directory's shape and nothing else: it creates it 700, tightens every
file to 600, deletes stray template symlinks, and lists templates that have no real file yet.
It never writes a credential, and it needs no root — `dot pkg secrets configure` runs the same
script as you, but demands a sudo ticket first (`runConfigure` asks unconditionally), so the
direct call above is the one to use.

## Why the templates are not under `home/`

dot's linker walks only `home/` and `system/` (`collectFiles`), so a template under
`home/.config/secrets/` becomes a **symlink into this repo, sitting inside the live credential
store**. That is what `~/.config/secrets` looked like until this package moved its templates to
`templates/`, which dot's linker structurally cannot reach — the same guarantee `etc-real/` uses,
for the opposite reason. `dot pkg secrets link` now links nothing, by design.

The loader's glob is `*(N.)`, without the `-` qualifier, so it stats the link itself rather than
its target and skips symlinks entirely. Both halves have to hold: the templates cannot get in,
and anything that does get in cannot be sourced.

## Adding a provider

```sh
install -m 600 packages/secrets/templates/deepseek ~/.config/secrets/deepseek
$EDITOR ~/.config/secrets/deepseek        # DEEPSEEK_API_KEY=sk-...
exec zsh -l                               # or source the file; login shells only
```

Track the template, never the filled file — `.gitignore` blocks the old `home/.config/secrets/`
path so the mistake cannot come back.

Parser limits, because it is deliberately dumb: `KEY=VALUE` verbatim, no quote stripping and no
expansion (`KEY="v"` keeps the quotes), `#` comments and blank lines skipped, keys must match
`[A-Za-z_][A-Za-z0-9_]*`. An empty `KEY=` is exported as an empty string, which some consumers
read as configured — leave the variable out instead.

Services do not see any of this: the loader runs in login shells only. A unit needs its own
`EnvironmentFile=-%h/.config/secrets/<name>` (systemd) or a `. <path>` line in its `run` script,
as `packages/agentmemory` does for minimax.

## Templates

| Template     | Real file                      | Consumer                                                       |
| ------------ | ------------------------------ | -------------------------------------------------------------- |
| `minimax`    | `~/.config/secrets/minimax`    | agentmemory's LLM provider                                     |
| `agent-web`  | `~/.config/secrets/agent-web`  | the web-verify skill's per-site logins                         |
| `deepseek`   | `~/.config/secrets/deepseek`   | omp's `deepseek` provider (`task`/`worker`/`smol`/`commit`)    |
| `openrouter` | `~/.config/secrets/openrouter` | omp's free-model fallback tier — see `~/.omp/agent/plan-b.yml` |
