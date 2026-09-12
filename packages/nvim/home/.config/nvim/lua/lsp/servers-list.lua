-- Single source of truth for LSP servers.
-- Both plugins/lsp/servers.lua and plugins/lsp/mason.lua consume this list.
-- To add or remove a server, change it here only.
local M = {}

M.servers = {
  'superhtml',
  'cssls',
  'vtsls',
  'eslint',
  'astro',
  'jsonls',
  'yamlls',
  'marksman',
  'bashls',
  'dockerls',
  'clangd',
  'lua_ls',
  'rust_analyzer',
  'ols',
  'dartls',
  'biome',
  'basedpyright',
  'ruff',
  'nixd',
}

-- Servers installed outside mason; mason-lspconfig must not try to manage them.
--   dartls – not in mason-lspconfig's registry (Flutter ships its own LSP)
--   nixd   – `nix profile install github:nix-community/nixd`, so mason would
--            install a second, unused copy
local external = { dartls = true, nixd = true }

-- Subset that mason-lspconfig can manage.
M.mason_servers = vim.tbl_filter(function(s) return not external[s] end, M.servers)

-- Per-filetype rules used by the guard and LspStatus.
--   expected  – servers that SHOULD attach; warn if absent after buffer opens
--   forbidden – servers that MUST NOT attach; stopped immediately on LspAttach
M.filetype_rules = {
  typescript = { expected = { 'vtsls' }, forbidden = { 'tailwindcss', 'ts_ls' } },
  typescriptreact = { expected = { 'vtsls' }, forbidden = { 'tailwindcss', 'ts_ls' } },
  javascript = { expected = { 'vtsls' }, forbidden = { 'tailwindcss', 'ts_ls' } },
  javascriptreact = { expected = { 'vtsls' }, forbidden = { 'tailwindcss', 'ts_ls' } },
  vue = { expected = { 'vtsls' }, forbidden = { 'tailwindcss' } },
  css = { expected = { 'cssls' }, forbidden = { 'tailwindcss' } },
  scss = { expected = { 'cssls' }, forbidden = { 'tailwindcss' } },
  less = { expected = { 'cssls' }, forbidden = { 'tailwindcss' } },
  html = { expected = { 'superhtml' }, forbidden = { 'tailwindcss' } },
  astro = { expected = { 'astro' }, forbidden = {} },
  json = { expected = { 'jsonls' }, forbidden = {} },
  jsonc = { expected = { 'jsonls' }, forbidden = {} },
  yaml = { expected = { 'yamlls' }, forbidden = {} },
  markdown = { expected = { 'marksman' }, forbidden = {} },
  sh = { expected = { 'bashls' }, forbidden = {} },
  bash = { expected = { 'bashls' }, forbidden = {} },
  dockerfile = { expected = { 'dockerls' }, forbidden = {} },
  c = { expected = { 'clangd' }, forbidden = {} },
  cpp = { expected = { 'clangd' }, forbidden = {} },
  lua = { expected = { 'lua_ls' }, forbidden = {} },
  rust = { expected = { 'rust_analyzer' }, forbidden = {} },
  python = { expected = { 'basedpyright', 'ruff' }, forbidden = { 'pylsp', 'pyright', 'jedi_language_server' } },
  odin = { expected = { 'ols' }, forbidden = {} },
  dart = { expected = { 'dartls' }, forbidden = {} },
  nix = { expected = { 'nixd' }, forbidden = { 'nil_ls', 'rnix' } },
}

return M
