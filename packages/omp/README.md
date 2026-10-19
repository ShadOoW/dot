# omp

Model roles for oh-my-pi live in the base config; one overlay optionally hides DeepSeek.

| profile     | command      | roles                                                                                                                                  |
| ----------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| base        | `omp`        | Opus for default, review (medium) and rereview (low); Sonnet for task/worker/smol; Haiku for commit — set in `~/.omp/agent/config.yml` |
| claude-only | `omp-claude` | the base roles, plus the `deepseek` provider disabled so no picker, cycle or retry chain can reach it                                  |

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

Measured on `/data/code/logos` (751 TS files, 924 MiB `node_modules`) — cold start,
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

## Questions are plain messages — `ask.enabled: false`

The `ask` picker is off. An agent that needs a decision ends its turn with an ordinary
reply: what the reader needs to know, the question, the options and its recommendation.
The reader answers by typing.

Why: the picker opens as a panel at the bottom of the screen, up to 70% of its height,
with a box repeating the question in the transcript above it. Whatever the agent wrote
just before the picker is pushed above the top of the screen and can only be read by
scrolling up or after answering. Measured on 2026-10-12 in a 40-row tmux pane: a 31-line
explanation lost its first 14 lines off the top while the picker was open. The picker's
question is cut to 4 lines, so the explanation cannot move into it, and upstream declined
changing the panel (can1357/oh-my-pi#12735, `wontfix`).

What failed before this, so it is not retried: a system-prompt rule asking for the
explanation as reply text beside the `ask` call (Opus 5.5 almost never writes text in a
response that also calls a tool: 794 of 12,155 such responses), then an `explain` tool
rendering the explanation above the picker, plus a guard blocking an `ask` without one
(2026-09-28 to 2026-10-12). The tool worked; the picker hid what it rendered.

The setting lives in `~/.omp/agent/config.yml`, which this package does not own (see the
top of this file). Set it once per host:

```sh
omp config set ask.enabled false
```

Check: `omp config get ask.enabled` prints `false`, and a new session's tool list has no
`ask`.

## Hooks — `hooks/`

- **A hook factory receives the full extension API.** omp loads `.ts` files from the hook
  directory as extension modules, so `registerCommand`, `setModel` and `registerTool` work
  there.
- **omp's native hook loader skips symlinked files.** It keeps only directory entries that
  are regular files (`Dirent.isFile()`), and dot links every file as a symlink, so a hook
  linked the normal way loads nothing and reports nothing. The real file lives in
  `packages/omp/hooks/`, and `home/.omp/agent/hooks` is a relative directory symlink to it
  (`../../../hooks`), linked as one entry, like `~/.omp/agent/commands` in the claude
  package. Add new hooks under `packages/omp/hooks/{pre,post}/`; no re-link needed.

## `/ss5`, `/so5`, `/sd4` — `hooks/pre/model-switch.ts`

Switch the session to Sonnet 5.5 (`/ss5`), Opus 5.5 (`/so5`) or DeepSeek V4.1 Flash (`/sd4`,
`deepseek/deepseek-flash`) without the `/model` picker, at effort `high`; an argument overrides
it (`/ss5 xhigh`; DeepSeek takes only `low`, `high`, `max`). The switch is for the session only:
`config.yml` is not written. Under `omp-claude` the deepseek provider is disabled, so `/sd4`
leaves the model unchanged. `/ss5` and `/so5` exist for plans, whose design and build
sessions alternate models (the `plans` skill, "Which model runs a session"). Loaded from the
hook directory (above).

Verify (each starts on the other model; the reply is the model after the switch):

```sh
cd /tmp && omp -p --model anthropic/claude-opus-5-5 "/ss5 xhigh" "Reply with only your exact model id, nothing else."
```

Expected: `anthropic/claude-sonnet-5-5`, and the session file under
`~/.omp/agent/sessions/-tmp/` ends with a `thinking_level_change` to `xhigh`.

## Helper guard — `hooks/pre/helper-guard.ts`

A Bruce helper that holds a shell (`bruce-catch-up`, `bruce-review`, `bruce-rereview`, `bruce-verify`; the claude
package README, _Helpers_) runs only the commands on its own list; anything else is refused with
the reason, which the helper reports instead of retrying. omp has no per-agent command rule, so
this extension checks every tool call of a subagent with one of those names (`ctx.agent.name`)
and blocks the rest. A new helper with a shell gets its list here before its agent file is linked.

It refuses every way it knows to run a program the rules do not name — `git -O<prog>`,
`--ext-diff`, `--textconv`, `--filters`, `--show-signature`, `%G`, `--exec-path`, `--config-env`,
a verbose `status`, `range-diff`, `npm run <script>` with anything after the script name,
`rg --pre`, `--search-zip`, `--hostname-bin`, and `brucelee sms db`, whose mongosh script is
arbitrary JavaScript no rule can read — and, for an allowed git read, it adds the flags that stop
the developer's own configuration from running one: `GIT_OPTIONAL_LOCKS=0`, `-c core.pager=cat -c
core.fsmonitor=false -c log.showSignature=false`, and `--no-ext-diff`/`--no-textconv` where the
read generates a patch. An insertion is the only edit it ever makes to a command.

It is not a boundary, and the file's header says at length what it does not bound — a repository's
own config naming a program the flags miss, a later git or ripgrep with a new channel, and the
three ways it is not reached at all (the operator's own session, an agent with a shell whose name
is not listed, a hook omp failed to load). Read the header before trusting it with anything.

- `bun test packages/omp/test` checks the lists; `just check` runs it.
- The guard reads a command line the way a shell would, quotes included, and refuses what it cannot
  read for certain: command substitution, heredocs, background jobs, redirects outside `/tmp`.

## Turn-end check — `hooks/pre/bruce-turn-end.ts`

A session in the Bruce workspace that wrote test files through `edit` or `write` cannot finish while the weak-test lint
(`brucelee ticket lint`, on the lines the branch added) is red on them: at `session_stop` the hook returns each problem with
its file, line, rule and message as a `block`, and the session fixes it in the same turn. Source files it changed get the
specs that import them named, with the command; nothing slow runs (a covering run is 98 s against a 30 s handler budget).

- Two caps, because omp counts a `block` against none: a problem set refused twice is let through (give the reason for a
  false positive in the reply), and so is a stop chain of six refusals.
- It fails open and says so: a missing `brucelee`, a 20 s timeout or unreadable output is a warning, never a block.
- It does not see a file a shell or `ast_edit` wrote, another person's lines in the same file, a session ended by
  interrupt, or Claude Code.
- Every stop writes a `bruce-turn-end` entry: `jq -c 'select(.customType=="bruce-turn-end").data' <session file>`.

Verify: `bun test packages/omp/test`.

## Hidden-check gate — `hooks/pre/bruce-check-gate.ts`

A session that changed the Bruce client (`app/client/web`) while its branch names a ticket with a hidden check cannot
finish until that check has graded the work as it stands. The check is the test written from the ticket before the fix,
which the session fixing the bug never reads (logos `apps/brucelee/lib/check.ts`). The developer sees the outcome at the
end of the session as a notice: `Hidden check BRC-9103: PASS on the work as it stands …`, a `FAIL` or `NOT RUN` when the
session was let through without a pass, or `Hidden check: none …` when the branch has no check.

- When a prompt starts in the workspace, the hook reads the client's tree id with `brucelee ticket verdict --json`
  (0.3 s, not awaited). At `session_stop` it reads it again; an unchanged tree with no `edit`/`write` in the lane ends
  the turn silently.
- A changed tree with no verdict on exactly that tree is refused with one instruction: run `brucelee ticket check`,
  which reads the ticket off the branch, grades the working tree as it stands (about two minutes, one run at a time)
  and records the verdict against the tree's id. A fail on that tree is refused with the failing row's title.
- The hook never runs the check itself: a run is about 100 s against a 30 s handler budget.
- Two caps, because omp counts a `block` against none: one tree refused twice in one state is let through, and so is a
  stop chain of four refusals; either way the developer is told. A verdict that cannot be read is a warning, never a
  block.
- It does not see lanes other than the client, a subagent's own stop (its writes are judged at the parent's), a
  session ended by interrupt, or Claude Code.
- Every judged stop writes a `bruce-check-gate` entry: `jq -c 'select(.customType=="bruce-check-gate").data' <session file>`.

Verify: `bun test packages/omp/test`.
