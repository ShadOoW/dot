# Dotfiles

Personal dotfiles for **Arch Linux**, **Void Linux**, and **macOS** — Sway/Wayland desktop, Neovim, Zsh, and friends.

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

| Command               | Description                                               |
| --------------------- | --------------------------------------------------------- |
| `dot link <pkg>`      | Symlink a package's files into place                      |
| `dot unlink <pkg>`    | Remove those symlinks                                     |
| `dot info <pkg>`      | Show metadata, files, and per-distro packages             |
| `dot configure <pkg>` | Run `configure.sh` for a package                          |
| `dot enable <pkg>`    | Run the enable script (init-system-aware)                 |
| `dot disable <pkg>`   | Run the disable script                                    |
| `dot update system`   | Update xbps/pacman, flatpak, bun, deno, rustup            |
| `dot update global`   | Update npm/bun/pipx/cargo global packages                 |
| `dot update source`   | Build/update pkgbuilds, fnm, anyzig, ly, zinit            |
| `dot update --info`   | Show installed versions                                   |
| `dot update --ai`     | Run update then analyse output with an AI provider        |
| `dot assets sync`     | Sync fonts, icons, themes from GitHub releases (parallel) |
| `dot doctor`          | Health-check all packages: broken symlinks, drift         |
| `dot doctor --fix`    | Auto-repair broken symlinks and re-link partial packages  |
| `dot completions zsh` | Print zsh completion script (pipe to `_dot` in `$fpath`)  |
| `dot docs`            | Browse setup documentation                                |

### Linking flags

```sh
dot link zsh                     # home files only
dot link zram                    # auto-detects runit or systemd
dot link ly --init runit         # explicit init override
dot link --tag wayland           # link all wayland-tagged packages
dot link nvim --dry-run          # preview without changes
```

Init system (runit vs systemd) is auto-detected from the running PID 1. Pass `--init` to override.

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
│   ├── runit/         # symlinked to / (when --init runit)
│   └── systemd/       # symlinked to / (when --init systemd)
├── configure.sh       # run with `dot configure`
├── enable-runit.sh    # run with `dot enable --init runit`
├── enable-systemd.sh  # run with `dot enable --init systemd`
└── disable-*.sh
```

### meta.json

Packages can declare metadata in `meta.json`:

```json
{
  "description": "Neovim with LSP and Mason",
  "packages": {
    "arch": {
      "pacman": ["neovim", "tree-sitter"],
      "brew": ["python-pynvim", "ripgrep", "fd"]
    },
    "void": {
      "xbps": ["neovim", "python3-neovim", "tree-sitter", "ripgrep", "fd"]
    },
    "macos": { "brew": ["neovim", "ripgrep", "fd"] }
  },
  "tags": ["editor", "dev"],
  "cleanSteps": ["rm -rf ~/.local/share/nvim"],
  "os": ["linux", "macos"]
}
```

`dot info <pkg>` shows packages filtered to the current distro. `dot link --tag <tag>` links all matching packages at once.

## Custom packages (pkgbuilds)

Packages not available in official repos (e.g. proprietary .deb-only software) live in `pkgbuilds/`. Each package is a directory with a `build.sh` that downloads the source, stages the files, and produces a native xbps package via `xbps-create` — no void-packages clone required.

```
pkgbuilds/
└── antigravity/
    ├── build.sh          # VERSION= at the top, full build + install logic
    └── antigravity.sh    # wrapper binary packaged into /usr/local/bin/
```

`dot update source` auto-discovers every `pkgbuilds/*/build.sh`, compares the `VERSION=` declared there against the installed xbps package, and rebuilds only when they differ. Built packages are cached in `~/.cache/dot/<name>/`.

**To update a package to a new release:**

1. Get the new download URL (it typically encodes version, timestamp, and MD5).
2. Compute the sha256 checksum: `sha256sum <file>.deb`
3. Update the variables at the top of `pkgbuilds/<name>/build.sh`:
   ```sh
   VERSION="1.24.0"
   TIMESTAMP="1787654321"
   MD5="<new-md5>"
   CHECKSUM="<new-sha256>"
   ```
4. Run `dot update source` — it detects the version mismatch and rebuilds.

To check without building: `dot update source --check`

## OS support

Shared `$HOME` is supported between Arch and Void (glibc). Node versions installed by fnm are ABI-compatible between both distros — install once, use on both.

The shell config auto-detects the distro at startup and exports `$_DISTRO` (`arch`, `void`, `macos`, `linux`) for use in all shell contexts.

## Clipboard

All clipboard operations go through `~/.local/bin/clipboard-copy` (linked via `dot link zsh`). It auto-selects `pbcopy` on macOS, `wl-copy` on Wayland, `xclip`/`xsel` on X11. Nothing is hardcoded.

## Node / fnm

fnm is installed natively via cargo on all Linux distros and via brew on macOS. FNM_DIR defaults to `~/.local/share/fnm` (or `~/.cache/managed-fnm` in managed mode). Since `$HOME` is shared between Arch and Void (both glibc), the same Node versions work on both.

```sh
# Install/update fnm
cargo install fnm

# Or via dot
dot update source
```

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

- The `docs/` directory has setup notes for fonts, NVIDIA, grub, snapper, pipewire, and zram.
- For Void-specific setup see `VOID.md`.
