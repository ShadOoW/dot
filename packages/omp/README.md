# omp

Model roles for oh-my-pi live in the base config; one overlay optionally hides DeepSeek.

| profile     | command      | roles                                                                                                 |
| ----------- | ------------ | ----------------------------------------------------------------------------------------------------- |
| base        | `omp`        | Opus for default, Sonnet for task/worker/smol, Haiku for commit — set in `~/.omp/agent/config.yml`    |
| claude-only | `omp-claude` | the base roles, plus the `deepseek` provider disabled so no picker, cycle or retry chain can reach it |

The roles live in `~/.omp/agent/config.yml`, which is **not** owned by this
package: omp rewrites that file itself (`settings.set`, the `/model` role
picker) and quarantines broken copies as `config.yml.bak-*` siblings. A symlink
into this repo would turn every in-session model change into a git diff and drop
backup files in `packages/`. Set roles with the picker or
`omp config set modelRoles '<json>'`, not by hand-editing a file a live omp may rewrite.

The roles used to exist only in the overlay. `dot session restore` resumes agents as
bare `omp -r <id>`, which drops `--config`, so a restored session ran every subagent on
the parent's Opus (~12% of one week's spend, 2026-09-21..25). Anything every launch
path must see belongs in `config.yml`; the overlay is for opt-in differences only.

## Why an overlay and not `omp --profile claude`

A named profile relocates the entire OMP user base — `agent.db` (which is the
auth store), sessions, blobs, `RULES.md`, skills, caches. Switching would mean a
second Anthropic login, a split session history, and duplicated rules, all for a
one-key difference (`disabledProviders`). Config overlays (`--config`,
`PI_CONFIG_FILES`) layer over the global config for one process and share
everything else.

Precedence, lowest to highest:
`schema defaults <- global config.yml <- project .omp <- PI_CONFIG_FILES <- --config <- runtime`.

## Switching

```sh
omp-claude                                                  # one run
export PI_CONFIG_FILES=$HOME/.omp/agent/claude-only.yml     # whole shell
unset PI_CONFIG_FILES                                       # back to base
```

Not switchable mid-session: overlays are read at process start. `/model` inside
a claude-only session writes to the global `config.yml`, which is why the overlay
must not repeat any key `config.yml` owns — a duplicate would mask the change.

## Reading effective settings

`omp config get <key>` ignores `--config` (it prints the base values whatever
you pass). Use the env form to inspect the claude-only layer:

```sh
PI_CONFIG_FILES=$HOME/.omp/agent/claude-only.yml omp config get disabledProviders
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

## Prompt additions — `APPEND_SYSTEM.md`

`home/.omp/agent/APPEND_SYSTEM.md` is added to the end of the system prompt of every
session started from the `omp` CLI, under omp's "User Instructions" heading, which
overrides conflicting built-in guidance. Subagents do not receive it (omp looks for the
file only in `main.ts`), and they have no `ask` tool anyway (`hasUI: false`). A
project-level `.omp/APPEND_SYSTEM.md` replaces it rather than stacking.

It holds one rule: explain in reply text, then call `ask`, and keep the picker's
`question` to one sentence. The first version (2026-09-28) said "write the context in
normal chat" and made things worse: the model planned the explanation in its reasoning,
which the user never sees, then sent the picker alone. Counted over every omp session, an
`ask` with no reply text in its turn went from 31 of 116 calls before that version to 13 of
27 after it. The rule now says that reasoning is invisible, and the hook below enforces it.

Check that it loaded:

```sh
omp -p --model @smol "Quote the system-prompt section about the ask picker, or say NONE."
```

## The ask guard — `hooks/pre/ask-needs-text.ts`

Blocks an `ask` call whose assistant message has under 20 characters of reply text, and
tells the model to write the explanation first and ask again. It fails open: a call it has
no record of goes through.

Two details it depends on:

- **`tool_call` fires before `message_end`.** The guard records text length from
  `message_update` snapshots, which already hold the finished tool call when the guard runs.
  Recording from `message_end` alone lets every call through.
- **omp's native hook loader skips symlinked files.** It keeps only directory entries that
  are regular files (`Dirent.isFile()`), and dot links every file as a symlink, so a hook
  linked the normal way loads nothing and reports nothing. The real file lives in
  `packages/omp/hooks/`, and `home/.omp/agent/hooks` is a relative directory symlink to it
  (`../../../hooks`), linked as one entry, like `~/.omp/agent/commands` in the claude
  package. Add new hooks under `packages/omp/hooks/{pre,post}/`; no re-link needed.

Verify in an interactive session (headless `-p` has no `ask` tool):

```sh
cd /tmp && omp --model @smol "Call the ask tool now with question 'Test?', options Yes and No, and no reply text before it."
```

Expected: the picker does not open, and the transcript shows "Blocked: this `ask` was sent
with no reply text…".
