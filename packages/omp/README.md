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
