# omp

Two model-role profiles for oh-my-pi, switchable per invocation.

| profile         | command      | roles                                                                                                      |
| --------------- | ------------ | ---------------------------------------------------------------------------------------------------------- |
| mixed (default) | `omp`        | Claude for default/slow/plan/designer/vision/tiny/advisor, `deepseek-v4-flash` for task/worker/smol/commit |
| claude-only     | `omp-claude` | Claude everywhere; the `deepseek` provider is disabled, so no role, picker or retry chain can reach it     |

The mixed profile lives in `~/.omp/agent/config.yml`, which is **not** owned by
this package: omp rewrites that file itself (`settings.set`, the `/model` role
picker) and quarantines broken copies as `config.yml.bak-*` siblings. A symlink
into this repo would turn every in-session model change into a git diff and drop
backup files in `packages/`. The overlay is the part that is declarative, so the
overlay is the part that is versioned here.

## Why an overlay and not `omp --profile claude`

A named profile relocates the entire OMP user base — `agent.db` (which is the
auth store), sessions, blobs, `RULES.md`, skills, caches. Switching would mean a
second Anthropic login, a split session history, and duplicated rules, all for a
four-line difference in `modelRoles`. Config overlays (`--config`,
`PI_CONFIG_FILES`) layer over the global config for one process and share
everything else.

Precedence, lowest to highest:
`schema defaults <- global config.yml <- project .omp <- PI_CONFIG_FILES <- --config <- runtime`.

## Switching

```sh
omp-claude                                                  # one run
export PI_CONFIG_FILES=$HOME/.omp/agent/claude-only.yml     # whole shell
unset PI_CONFIG_FILES                                       # back to mixed
```

Not switchable mid-session: overlays are read at process start. `/model` inside
a claude-only session writes to the global `config.yml` — it edits the _mixed_
profile, and the overlay keeps masking it.

## Reading effective settings

`omp config get <key>` ignores `--config` (it prints the mixed values whatever
you pass). Use the env form to inspect the claude-only layer:

```sh
PI_CONFIG_FILES=$HOME/.omp/agent/claude-only.yml omp config get modelRoles
```

## Adding a third profile

Copy `home/.omp/agent/claude-only.yml`, override the roles that differ, add a
wrapper next to `home/.local/bin/omp-claude`, then `dot pkg omp link`. Keep the
overlays additive: they should contain only the keys that differ from
`config.yml`, never a full copy of it.

## Language servers — `lsp.json`

`home/.omp/agent/lsp.json` moves TypeScript code intelligence off node. omp otherwise
auto-detects `typescript-language-server`, which forks a `tsserver` child holding the
whole program graph in a V8 heap; TypeScript 7 ships the same language server compiled
to a single Go binary and speaks LSP directly (`tsc --lsp --stdio`).

Linking is not enough — the Go binary is not a distro package and lives outside this
repo, so a fresh machine needs both halves:

```sh
dot pkg omp link         # the config
dot pkg omp configure    # the server it names (installs, wrapper, PATH symlink)
```

Without the second, `tsgo-lsp` does not resolve and omp quietly keeps using the node
server. `configure.sh` is idempotent and safe to re-run; it is also how you pick up a
newer TypeScript (`TYPESCRIPT_NATIVE_VERSION=7.1.0 dot pkg omp configure`). The sudo
prompt is `dot`'s gate on every `configure` action, not this script — it writes only
inside `$HOME`.

Measured on `/data/code/fleet` (751 TS files, 924 MiB `node_modules`) — cold start,
`initialize` -> `didOpen` -> `hover` -> `references`, peak PSS over the whole process
tree:

| server                                        |    peak PSS | procs | hover |
| --------------------------------------------- | ----------: | ----: | ----: |
| `typescript-language-server` + tsserver, node | **900 MiB** |     4 | 337ms |
| `tsc --lsp --stdio`, TypeScript 7.0.2 (Go)    | **308 MiB** |     1 | 195ms |

That saving repeats per concurrent agent session, which is the point on a 31 GiB box
that routinely runs five.

A single hover cannot see a leak, and `microsoft/typescript-go#3032` alleges one in
`--lsp` mode (closed for want of a repro; one reporter saw 50 GB). So the same probe was
run as a real session instead: 150 fleet files, each opened, edited, queried for symbols
and closed, three passes.

| server             | pass 1  | pass 2   | pass 3   |     peak | after 8s idle |
| ------------------ | ------- | -------- | -------- | -------: | ------------: |
| node stack         | 908 MiB | 1176 MiB | 1522 MiB | 2155 MiB |      2155 MiB |
| native (Go)        | 739 MiB | 943 MiB  | 1091 MiB | 1205 MiB |       780 MiB |
| native, GOMEMLIMIT | 653 MiB | 615 MiB  | 610 MiB  |  659 MiB |       610 MiB |

Both grow under load; the node stack grows faster, peaks 1.8x higher, and is the only
one that never gives any of it back. Under a Go heap ceiling the native server is flat.
So `#3032` is bounded here rather than believed or dismissed — see `configure.sh`.

Four details the file depends on, all explained at length in `configure.sh`:

- The install lives in `~/.local/share/typescript-native`, off PATH, so `tsc` still
  means Arch's 6.0.3 for builds. `configure.sh` installs it; it is not a distro package.
- `command` is the bare name `tsgo-lsp`, resolved through PATH. It cannot be a path:
  JSON has no `$HOME`, and omp does not expand `~` — a tilde path resolves to nothing
  and omp falls back to `typescript-language-server` without saying so.
- `tsgo-lsp` is a symlink into `$PREFIX/lsp/bin/tsc`, a generated wrapper that exports
  `GOMEMLIMIT` (1536 MiB, or `TSGO_MEM_LIMIT`), because `ServerConfig` has no `env`
  field. It is the Go analogue of the `--max-old-space-size` shim at
  `~/.local/bin/typescript-language-server`.
- Nothing in that chain may point at the raw Go binary. omp picks between the two
  TypeScript servers by realpathing the resolved command, walking to a typescript package
  dir, and testing for `lib/tsserver.js`; only a `bin/` layout with a `package.json`
  above it satisfies that walk. The node launcher in that path costs nothing — it
  `process.execve`s into the Go binary rather than staying resident.

`idleTimeoutMs: 300000` is in the same file: language servers idle for five minutes are
shut down instead of held for the life of the session.

Tune the ceiling per workload — a monorepo bigger than fleet may want more headroom, a
laptop less. The wrapper reads `TSGO_MEM_LIMIT` when omp spawns it and inherits it from
omp's own environment, so this is a shell variable, not a reinstall:

```sh
TSGO_MEM_LIMIT=3GiB omp          # one run
export TSGO_MEM_LIMIT=3GiB       # whole shell
```

Verified by reading `GOMEMLIMIT` out of the live server's `/proc/<pid>/environ`: unset
gives `1536MiB`, `TSGO_MEM_LIMIT=3GiB` gives `3GiB`. To move the default instead, edit
the fallback in `configure.sh` and re-run `dot pkg omp configure`.

Too low is not a crash — Go treats `GOMEMLIMIT` as a soft limit and collects harder —
but a ceiling below the project's live working set spends the CPU you saved on GC.

Verify which server a project resolved:

```sh
cd <project> && omp -p "Call the lsp tool with action=status." --model @smol
```

`typescript-native` in that list means the swap is live; `typescript-language-server`
means it fell back, and the heap-cap shim at `~/.local/bin/typescript-language-server`
is what bounds it.
