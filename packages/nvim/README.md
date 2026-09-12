# nvim - Neovim with LSP and Mason

## System Packages (Void Linux)

```
xbps-install neovim neovim-lua luajit ripgrep fd findutils
xbps-install just stylua shfmt shellcheck prettierd ruff taplo
xbps-install ctags pandoc glow
xbps-install python3 python3-pip
```

## Mason Tools (auto-installed on first run)

LSP servers (configured in `lua/lsp/servers-list.lua`):

- vtsls, astro, eslint, jsonls, yamlls, marksman, bashls
- dockerls, clangd, lua_ls, rust_analyzer, ols, biome, basedpyright, ruff
- superhtml, cssls

Not from mason (see `external` in `lua/lsp/servers-list.lua`): `dartls` ships
with Flutter, `nixd` comes from the nix profile.

Linters/Formatters (configured in `lua/plugins/lsp/mason-tool-installer.lua`):

- Formatters: prettierd, rustywind, stylua, shfmt, gofumpt, goimports
- Formatters: sql-formatter, clang-format, xmlformatter, taplo, kulala-fmt, odinfmt
- Linters: markdownlint-cli2, stylelint, htmlhint, jsonlint, yamllint, luacheck
- Linters: golangci-lint, shellcheck, hadolint, sqlfluff
- Misc: tree-sitter-cli

## Nix tooling

Nix files get diagnostics from nixd and formatting from nixfmt; neither has a
mason package, so both live in the nix profile:

```bash
nix profile install github:nix-community/nixd
nix profile install nixpkgs#nixfmt
```

nixd is configured without `nixpkgs.expr`/`options`, so it never evaluates all
of nixpkgs (that costs GBs of RSS per buffer); it parses and formats only.

## Setup

```bash
mkdir -p /tmp/nvim/{swap,backup,undo}
chmod 700 /tmp/nvim/{swap,backup,undo}
```
