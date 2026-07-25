-- OLS (Odin Language Server) configuration
-- OLS is the official language server for the Odin programming language
-- GitHub: https://github.com/DanielGavin/ols
return {
  -- OLS server settings
  settings = {
    -- Note: OLS doesn't use nested settings like other LSP servers
    -- Configuration is typically done via ols.json in the project root
    -- or via initialization options
  },

  -- Initialization options for OLS
  init_options = {
    -- Enable semantic tokens for better syntax highlighting
    enable_semantic_tokens = true,

    -- Enable document symbols for outline view
    enable_document_symbols = true,

    -- Enable hover information
    enable_hover = true,

    -- Enable code snippets
    enable_snippets = true,

    -- Enable formatting with odinfmt
    enable_format = true,

    -- Enable inlay hints for supported editors
    enable_inlay_hints = true,

    -- Enable procedure snippets (adds parentheses after completion)
    enable_procedure_snippet = true,

    -- Enable fake methods completion (experimental)
    enable_fake_methods = false,

    -- Enable references finding (experimental)
    enable_references = true,

    -- Enable symbol renaming (experimental)
    enable_rename = true,

    -- Only check the package being saved (performance optimization)
    enable_checker_only_saved = false,

    -- Pass additional arguments to 'odin check'
    checker_args = '',

    -- Enable verbose logging
    verbose = false,

    -- Collections can be configured here, but typically done via ols.json
    -- collections = {
    --   { name = 'core', path = '/path/to/odin/core' },
    --   { name = 'vendor', path = '/path/to/odin/vendor' },
    -- },
  },

  -- File types that OLS should handle
  filetypes = { 'odin' },

  -- Single file support
  single_file_support = true,

  -- Custom capabilities
  capabilities = (function()
    local capabilities = require('cmp_nvim_lsp').default_capabilities()

    -- OLS supports these LSP features
    capabilities.textDocument.completion.completionItem.snippetSupport = true
    capabilities.textDocument.completion.completionItem.resolveSupport = {
      properties = { 'documentation', 'detail', 'additionalTextEdits' },
    }

    return capabilities
  end)(),

  -- Custom handlers for OLS-specific features
  handlers = {
    -- Custom hover handler to improve formatting
    ['textDocument/hover'] = function(_, result, ctx, config)
      if not result or not result.contents then return end

      -- Use vim.lsp.util.open_floating_preview for better formatting
      local bufnr, winnr =
        vim.lsp.util.open_floating_preview(result.contents.value or result.contents, 'markdown', config or {})

      return bufnr, winnr
    end,
  },

  -- Custom on_attach function for OLS-specific keybindings
  on_attach = function(client, bufnr)
    -- Standard LSP keybindings are handled by the main LSP configuration
    -- Add any OLS-specific keybindings here if needed

    -- Enable inlay hints if supported
    if client.server_capabilities.inlayHintProvider and vim.lsp.inlay_hint then
      vim.lsp.inlay_hint.enable(true, {
        bufnr = bufnr,
      })
    end

    -- Format on save is handled by conform.nvim (odin uses lsp_format = 'prefer';
    -- single formatter path, no duplicate BufWritePre autocmd here).
  end,
}
