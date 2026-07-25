-- ESLint LSP server configuration
return {
  -- Apply all ESLint fixes on save via the LSP (single JS/TS fix-on-save path;
  -- conform intentionally skips these filetypes).
  on_attach = function(client, bufnr)
    require('lsp.handlers').on_attach(client, bufnr)

    -- Per-buffer augroup name so a second buffer doesn't clear the first's autocmd
    vim.api.nvim_create_autocmd('BufWritePre', {
      group = vim.api.nvim_create_augroup('EslintFixAll_' .. bufnr, { clear = true }),
      buffer = bufnr,
      callback = function()
        if vim.g.disable_autoformat or vim.b[bufnr].disable_autoformat then return end
        if not client:is_stopped() then
          client:request_sync('workspace/executeCommand', {
            command = 'eslint.applyAllFixes',
            arguments = {
              {
                uri = vim.uri_from_bufnr(bufnr),
                version = vim.lsp.util.buf_versions[bufnr],
              },
            },
          }, 3000, bufnr)
        end
      end,
      desc = 'Apply all ESLint fixes before save',
    })
  end,

  settings = {
    codeAction = {
      disableRuleComment = {
        enable = true,
        location = 'separateLine',
      },
      showDocumentation = {
        enable = true,
      },
    },
    codeActionOnSave = {
      enable = false,
      mode = 'all',
    },
    onIgnoredFiles = 'off',
    packageManager = 'npm',
    problems = {
      shortenToSingleLine = false,
    },
    quiet = false,
    rulesCustomizations = {},
    run = 'onType',
    useESLintClass = false,
    validate = 'on',
  },
  filetypes = {
    'javascript',
    'javascriptreact',
    'typescript',
    'typescriptreact',
    'vue',
    'svelte',
    'astro',
  },
  single_file_support = false,
  workspace_required = true,
}
