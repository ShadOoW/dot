# claude — Claude Code config + shared agent commands

Manages Claude Code's user-level config and the slash-command library that is
**shared with the Oh My Pi (`omp`) harness**.

## What this package manages

| Path                         | Form                         | Why                                                                                     |
| ---------------------------- | ---------------------------- | --------------------------------------------------------------------------------------- |
| `~/.claude/commands/*.md`    | per-file symlinks            | Claude Code user commands. Per-file so unmanaged local commands can live alongside them |
| `~/.omp/agent/commands`      | directory symlink            | Same files, exposed to `omp`'s **native** command provider. Nothing else writes here    |
| `~/.local/bin/claude-turn-*` | symlinks                     | Stop / UserPromptSubmit hook scripts referenced from `settings.json`                    |
| `~/.claude/skills/bruce`     | symlink (via `configure.sh`) | Points straight at `/data/code/fleet/skills/bruce`; no copy, no drift possible          |

## Skills payload

`home/.claude/skills/` no longer carries `kit` or `effect` copies. Both are fleet-owned
(`/data/code/fleet/skills/kit` and `/data/code/fleet/vendor/kit-skills/`); per-project
materialization (`ops <project> agent-context`) is the only distribution path for `kit`,
and `effect` is read at the vendored ref rather than mirrored here. Keeping a copy meant
hand-syncing it forever — the `effect` copy had already drifted 8 files out of sync with
its authority before this package stopped carrying it.

`bruce` is no longer a copy either: `configure.sh` creates
`~/.claude/skills/bruce` as a symlink straight to `/data/code/fleet/skills/bruce`, so
there is nothing here to regenerate or drift.

## Sharing one command library across both harnesses

Canonical source: `home/.claude/commands/*.md`. One copy, two consumers.

```mermaid
graph LR
  A["packages/claude/home/.claude/commands/*.md<br/>(canonical, in git)"]
  A -->|per-file symlink| B["~/.claude/commands/*.md"]
  A -->|dir symlink via home/.omp/agent/commands| C["~/.omp/agent/commands"]
  B --> D["Claude Code"]
  C --> E["omp — native provider (priority 100)"]
  B -.->|"also readable, shadowed"| E
```

`home/.omp/agent/commands` is a **relative symlink inside the repo**
(`../../.claude/commands`). dot's linker walks `home/` with `readdir` +
`Dirent.isDirectory()`, so a symlinked directory is emitted as a _single_ link
entry rather than being traversed — `~/.omp/agent/commands` becomes one symlink
that chains through the repo to the real command directory.

### Why the two sides use different link granularity

- **`~/.claude/commands` is per-file.** Claude Code itself writes into this
  directory, and non-dot local commands should be able to sit next to the
  managed ones. Cost: adding a new command file needs `dot pkg claude link`
  before Claude Code sees it — the normal dot workflow for every package.
- **`~/.omp/agent/commands` is the whole directory.** No `omp` feature writes
  user commands there (`omp agents unpack` targets `~/.omp/agent/agents`), so
  owning the whole path is safe and means new commands appear in `omp`
  immediately, with no re-link.

### Duplicate discovery in omp is expected and harmless

`omp` finds each command twice: once via the `native` provider
(`~/.omp/agent/commands`, priority 100) and once via the `claude` compat
provider (`~/.claude/commands`, priority 80). Capability dedup is first-wins by
name, so `native` always wins; the loser is kept only in the shadowed list shown
by the Extensions dashboard.

To silence the shadow entries entirely, set in `~/.omp/agent/config.yml`:

```yaml
commands:
  enableClaudeUser: false
```

Left at the default (`true`) on purpose — it keeps any _unmanaged_ command
dropped into `~/.claude/commands` visible to `omp` too.

### Profile caveat

The native symlink covers the **default** `omp` profile only. Named profiles
read `~/.omp/profiles/<name>/agent/commands`. Add one symlink per profile under
`home/.omp/profiles/<name>/agent/commands` if you start using them.

## Adding a command

```sh
$EDITOR /data/config/dot/packages/claude/home/.claude/commands/my-command.md
dot pkg claude link   # links the new file into ~/.claude/commands
```

`omp` picks it up with no re-link. Verify both harnesses:

```sh
omp   -p '/my-command'
claude -p '/my-command'
```

## Verify the wiring

```sh
dot doctor claude   # expect: no broken symlinks or drift
readlink ~/.omp/agent/commands                    # -> packages/claude/home/.omp/agent/commands
ls ~/.omp/agent/commands/                         # -> the same 15 .md files as ~/.claude/commands
```
