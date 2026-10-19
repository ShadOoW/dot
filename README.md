# Dotfiles

Personal configuration for the NixOS desk and the macOS MacBook — Sway/Wayland desktop, Neovim, Zsh, and friends.

> This is a reference, not an installer. Read and understand before applying anything.

<div align="center">
  <table>
    <tr>
      <td align="center">
        <img src="screenshot-1.png" width="400px" alt="Neovim + Kitty">
        <p>Dev Environment</p>
      </td>
      <td align="center">
        <img src="screenshot-2.png" width="400px" alt="Tig + Ncmpcpp">
        <p>Tig + Ncmpcpp</p>
      </td>
      <td align="center">
        <img src="screenshot-3.png" width="400px" alt="Rofi + Waybar">
        <p>Rofi + Waybar</p>
      </td>
    </tr>
  </table>
</div>

## The `dot` CLI

All management goes through the `dot` CLI (TypeScript/Bun):

```sh
dot <command>
```

### Commands

| Command                   | Description                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| `dot pkg <pkg> link`      | Symlink a package's files into place                                                      |
| `dot pkg <pkg> unlink`    | Remove those symlinks                                                                     |
| `dot pkg <pkg> info`      | Show metadata, files, and package declarations                                            |
| `dot pkg <pkg> configure` | Run `configure.sh` for a package                                                          |
| `dot pkg <pkg> enable`    | Run the package's enable script                                                           |
| `dot pkg <pkg> disable`   | Run the disable script                                                                    |
| `dot update system`       | Update package managers and self-managed runtimes (distribution-package paths are parked) |
| `dot update global`       | Update npm/bun/pipx/cargo global packages                                                 |
| `dot update source`       | Build/update fnm, anyzig, ly, zinit                                                       |
| `dot update --info`       | Show installed versions                                                                   |
| `dot update --ai`         | Run update then analyse output with an AI provider                                        |
| `dot assets sync`         | Sync fonts, icons, themes from GitHub releases (parallel)                                 |
| `dot doctor`              | Health-check all packages: broken symlinks, drift                                         |
| `dot doctor --fix`        | Auto-repair broken symlinks and re-link partial packages                                  |
| `dot completions zsh`     | Print zsh completion script (pipe to `_dot` in `$fpath`)                                  |
| `dot docs`                | Browse setup documentation                                                                |

### Linking flags

```sh
dot pkg zsh link                 # home files only
dot pkg sway link                # a Wayland desktop package
dot pkg --tag wayland link       # link all wayland-tagged packages
dot pkg nvim link --dry-run      # preview without changes
```

## Package structure

Every directory in `packages/` is a package. No registration needed.

```
packages/<name>/
├── meta.json          # machine-readable metadata (optional)
├── README.md          # human notes (optional)
├── home/              # symlinked to ~/
│   └── .config/<app>/
├── system/
│   ├── base/          # symlinked to / (always)
│   ├── systemd/       # symlinked to / (Linux)
│   └── launchd/       # symlinked to ~/Library/LaunchAgents (macOS)
├── configure.sh       # run with `dot pkg <pkg> configure`
├── enable-*.sh        # run with `dot pkg <pkg> enable`
└── disable-*.sh
```

### meta.json

Packages can declare metadata in `meta.json`:

```json
{
  "description": "Neovim with LSP and Mason",
  "packages": {
    "nixos": {},
    "macos": { "brew": ["neovim", "ripgrep", "fd"] }
  },
  "tags": ["editor", "dev"],
  "cleanSteps": ["rm -rf ~/.local/share/nvim"],
  "os": ["linux", "macos"]
}
```

`nixos` is a distro key with no package manager; the flake declares the desk's packages.
`dot pkg <pkg> info` shows the packages that apply to the current host and OS, and
`dot pkg --tag <tag> link` links all matching packages at once.

## Hosts

- **desk** — NixOS 26.05 in a container on punk. The system layer is declared in the fleet
  flake (`/data/code/logos/fleet/machines/desktop/`); this payload owns `~/.config` and the
  other home files.
- **Mac** — macOS. This payload owns `home/` and `system/launchd/`.

The shell config auto-detects the host and exports `$_DISTRO` (`nixos` on the desk, `macos` on
the Mac) for use in all shell contexts.

## Clipboard

All clipboard operations go through `~/.local/bin/clipboard-copy` (linked via `dot pkg zsh link`). It auto-selects `pbcopy` on macOS, `wl-copy` on Wayland, `xclip`/`xsel` on X11. Nothing is hardcoded.

## Node / fnm

fnm is declared by the desk's flake and installed by brew on the Mac. FNM_DIR defaults to
`~/.local/share/fnm` (or `~/.cache/managed-fnm` in managed mode).

## AI analysis (`--ai`)

`dot update --ai` and `dot cache clean --ai` pipe their output to an LLM that filters it down to only errors, warnings, and required actions. Provider is selected by the first matching env var:

| Env var             | Provider | Model override          |
| ------------------- | -------- | ----------------------- |
| `MINIMAX_API_KEY`   | MiniMax  | `MINIMAX_MODEL`         |
| `ANTHROPIC_API_KEY` | Claude   | `CLAUDE_MODEL`          |
| `OLLAMA_HOST`       | Ollama   | `OLLAMA_MODEL` (llama3) |

## Shell completions

```sh
# Install once:
dot completions zsh > ~/.local/share/zsh/completions/_dot
# Re-run whenever packages or assets change.
```

## Notes

- Setup notes for the live `dot session` command are in `docs/session.md`.
- The `dot` CLI itself lives in `/data/code/logos/apps/dot`; this repo holds no TypeScript.
