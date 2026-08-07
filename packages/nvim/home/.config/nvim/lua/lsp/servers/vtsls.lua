-- vtsls LSP configuration.
-- root_dir intentionally omitted — nvim-lspconfig's default (lsp/vtsls.lua) uses the
-- new neovim 0.11+ async API (bufnr, on_dir). Overriding it with the old synchronous
-- API (fname) causes root_dir to always return nil and the server to never start.
return {
  -- cmd intentionally omitted — uses lspconfig default 'vtsls --stdio', which resolves
  -- through mason's PATH entry. No need to hardcode the mason binary path.
  filetypes = {
    'javascript',
    'javascriptreact',
    'typescript',
    'typescriptreact',
    'vue',
  },
  settings = {
    vtsls = {
      experimental = {
        completion = {
          enableServerSideFuzzyMatch = true,
        },
      },
      workspaceSymbols = {
        scope = 'workspace',
      },
    },
    typescript = {
      inlayHints = {
        includeInlayParameterNameHints = 'literal',
        includeInlayParameterNameHintsWhenArgumentMatchesName = false,
        includeInlayFunctionParameterTypeHints = true,
        includeInlayVariableTypeHints = false,
        includeInlayVariableTypeHintsWhenTypeMatchesName = false,
        includeInlayPropertyDeclarationTypeHints = true,
        includeInlayFunctionLikeReturnTypeHints = true,
        includeInlayEnumMemberValueHints = true,
      },
      preferences = {
        quotePreference = 'single',
        includeCompletionsForModuleExports = true,
        includeCompletionsForImportStatements = true,
        includeCompletionsWithSnippetText = true,
        includeAutomaticOptionalChainCompletions = true,
        includeCompletionsWithInsertText = true,
        allowIncompleteCompletions = true,
        generateReturnInDocTemplate = true,
        includePackageJsonAutoImports = 'auto',
        useLabelDetailsInCompletionEntries = true,
      },
      suggest = {
        autoImports = true,
        completeFunctionCalls = false,
        completeJSDocs = true,
        enabled = true,
        names = true,
        paths = true,
      },
      updateImportsOnFileMove = { enabled = 'always' },
      surveys = { enabled = false },
    },
    javascript = {
      inlayHints = {
        includeInlayParameterNameHints = 'all',
        includeInlayParameterNameHintsWhenArgumentMatchesName = false,
        includeInlayFunctionParameterTypeHints = true,
        includeInlayVariableTypeHints = true,
        includeInlayVariableTypeHintsWhenTypeMatchesName = false,
        includeInlayPropertyDeclarationTypeHints = true,
        includeInlayFunctionLikeReturnTypeHints = true,
        includeInlayEnumMemberValueHints = true,
      },
      preferences = {
        quotePreference = 'single',
        includeCompletionsForModuleExports = true,
        includeCompletionsForImportStatements = true,
        includeAutomaticOptionalChainCompletions = true,
        includeCompletionsWithInsertText = true,
        allowIncompleteCompletions = true,
        includePackageJsonAutoImports = 'auto',
        useLabelDetailsInCompletionEntries = true,
      },
      suggest = {
        autoImports = true,
        completeFunctionCalls = false,
        enabled = true,
      },
      updateImportsOnFileMove = { enabled = 'always' },
      surveys = { enabled = false },
    },
    completions = {
      completeFunctionCalls = true,
    },
  },
  init_options = {
    hostInfo = 'neovim',
    -- 8192 was a ceiling this machine cannot honour: one tsserver allowed to reach 8 GiB on
    -- a 31 GiB box that also runs a browser and several agents is a licence to trigger the
    -- OOM killer by itself. Measured real usage across two live servers on 2026-08-05 was
    -- 1.29 and 1.15 GiB, so 3 GiB is still >2x headroom. If a genuinely huge project hits
    -- the cap, tsserver exits and the client respawns it — a reindex, not lost work.
    maxTsServerMemory = 3072,
  },
  single_file_support = true,
}
