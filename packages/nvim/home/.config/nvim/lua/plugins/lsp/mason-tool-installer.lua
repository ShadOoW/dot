return {
  'WhoIsSethDaniel/mason-tool-installer.nvim',
  dependencies = { 'williamboman/mason.nvim', 'williamboman/mason-lspconfig.nvim' },
  event = 'VeryLazy',
  config = function()
    -- LSP servers come from the single source of truth (lua/lsp/servers-list.lua).
    -- mason-tool-installer resolves lspconfig names via mason-lspconfig, so the
    -- list below never drifts from what lsp/guard.lua allows (no more orphans).
    local ensure_installed = vim.deepcopy(require('lsp.servers-list').mason_servers)

    -- Non-LSP tools: formatters used by conform.nvim
    vim.list_extend(ensure_installed, {
      'prettierd',
      'rustywind',
      'stylua',
      'shfmt',
      'gofumpt',
      'goimports',
      'sql-formatter',
      'clang-format',
      'xmlformatter',
      'taplo',
      'kulala-fmt',
      'odinfmt',
    })

    -- Non-LSP tools: linters used by nvim-lint
    vim.list_extend(ensure_installed, {
      'markdownlint-cli2',
      'stylelint',
      'htmlhint',
      'jsonlint',
      'yamllint',
      'luacheck',
      'golangci-lint',
      'shellcheck',
      'hadolint',
      'sqlfluff',
    })

    -- Misc tooling
    vim.list_extend(ensure_installed, {
      'tree-sitter-cli',
    })

    require('mason-tool-installer').setup({
      ensure_installed = ensure_installed,
      auto_update = false,
      run_on_start = true,
      start_delay = 3000, -- 3 second delay
      debounce_hours = 5, -- at least 5 hours between attempts
    })
  end,
}
