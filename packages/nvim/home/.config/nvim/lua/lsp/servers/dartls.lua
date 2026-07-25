-- Dart Language Server configuration for Flutter development
-- Provides comprehensive Dart and Flutter support including:
-- - Code completion and analysis
-- - Flutter widget tree analysis
-- - Hot reload integration
-- - Pub package management
-- - Flutter outline and widget inspector
return {
  -- Dart LSP settings
  settings = {
    dart = {
      -- Enable all analysis features
      analysisExcludedFolders = { vim.fn.expand('$HOME/.pub-cache'), vim.fn.expand('$HOME/fvm') },

      -- Enable additional Dart features
      enableSnippets = true,
      enableSdkFormatter = true,
      includeDependenciesInWorkspaceSymbols = true,
      previewLsp = true,

      -- Flutter-specific settings
      flutter = {
        -- Enable Flutter widget tree and inspector
        widget = {
          completionStyle = 'named',
          showTodos = true,
        },

        -- Hot reload settings
        hotReload = {
          -- Auto hot reload on save
          onSave = true,
        },

        -- Flutter outline
        outline = {
          -- Show Flutter widget tree in outline
          showFlutterOutline = true,
        },

        -- Performance optimizations
        performance = {
          -- Skip large file analysis for better performance
          skipLargeFileAnalysis = true,
        },
      },

      -- Code completion settings
      completion = {
        -- Include all available completions
        showConstructorInvocations = true,
        showParameterTypes = true,
        showParameterNames = true,
      },

      -- Linting and analysis
      linting = {
        -- Enable all lints
        enableLinting = true,

        -- Custom lint rules for Flutter
        rules = { -- Prefer single quotes
          'prefer_single_quotes', -- Avoid print statements in production
          'avoid_print', -- Use const constructors when possible
          'prefer_const_constructors', -- Use const literals when possible
          'prefer_const_literals_to_create_immutables', -- Avoid slow operations
          'avoid_slow_async_io', -- Sort imports
          'directives_ordering',
        },
      },

      -- Documentation and hover
      documentation = {
        -- Include documentation in hover
        includeSourceInHover = true,
        -- Show parameter documentation
        showParameterDocumentation = true,
      },
    },
  },

  -- File types for Dart/Flutter
  filetypes = { 'dart' },

  -- Single file support for standalone Dart files
  single_file_support = true,

  -- Initialize options
  init_options = {
    -- Only send analytics data if user has opted in
    sendAnalytics = false,
    -- Enable all Dart SDK features
    enableServerSnippets = true,
    -- Include suggestions from dependencies
    includeDependenciesInWorkspaceSymbols = true,
    -- Enable closing labels for Flutter widgets
    closingLabels = true,
    -- Enable outline view
    outline = true,
    -- Enable Flutter outline
    flutterOutline = true,
  },

  -- Enhanced capabilities for Flutter development
  capabilities = (function()
    local capabilities = require('cmp_nvim_lsp').default_capabilities()

    -- Dart/Flutter specific capabilities
    capabilities.textDocument.completion.completionItem.snippetSupport = true
    capabilities.textDocument.completion.completionItem.resolveSupport = {
      properties = { 'documentation', 'detail', 'additionalTextEdits' },
    }

    -- Enable workspace folders for multi-package Flutter apps
    capabilities.workspace.workspaceFolders = true

    return capabilities
  end)(),

  -- Custom on_attach for Flutter-specific features
  on_attach = function(client, bufnr)
    -- Standard LSP on_attach (handled by main LSP config)
    -- Add Flutter-specific keybindings
    local opts = {
      noremap = true,
      silent = true,
      buffer = bufnr,
    }

    -- Flutter-specific commands
    vim.keymap.set(
      'n',
      '<leader>zr',
      function() vim.cmd('!flutter run') end,
      vim.tbl_extend('force', opts, {
        desc = 'Flutter: Run app',
      })
    )

    vim.keymap.set(
      'n',
      '<leader>zh',
      function()
        -- Trigger hot reload
        client:exec_cmd({
          command = 'dart.hotReload',
          arguments = {},
        }, { bufnr = bufnr })
      end,
      vim.tbl_extend('force', opts, {
        desc = 'Flutter: Hot reload',
      })
    )

    vim.keymap.set(
      'n',
      '<leader>zH',
      function()
        -- Trigger hot restart
        client:exec_cmd({
          command = 'dart.hotRestart',
          arguments = {},
        }, { bufnr = bufnr })
      end,
      vim.tbl_extend('force', opts, {
        desc = 'Flutter: Hot restart',
      })
    )

    vim.keymap.set(
      'n',
      '<leader>zd',
      function() vim.cmd('!flutter doctor') end,
      vim.tbl_extend('force', opts, {
        desc = 'Flutter: Doctor',
      })
    )

    vim.keymap.set(
      'n',
      '<leader>zc',
      function() vim.cmd('!flutter clean') end,
      vim.tbl_extend('force', opts, {
        desc = 'Flutter: Clean',
      })
    )

    vim.keymap.set(
      'n',
      '<leader>zp',
      function() vim.cmd('!flutter pub get') end,
      vim.tbl_extend('force', opts, {
        desc = 'Flutter: Pub get',
      })
    )

    vim.keymap.set(
      'n',
      '<leader>zt',
      function() vim.cmd('!flutter test') end,
      vim.tbl_extend('force', opts, {
        desc = 'Flutter: Run tests',
      })
    )

    vim.keymap.set(
      'n',
      '<leader>zb',
      function() vim.cmd('!flutter build apk') end,
      vim.tbl_extend('force', opts, {
        desc = 'Flutter: Build APK',
      })
    )

    vim.keymap.set(
      'n',
      '<leader>zo',
      function()
        -- Open Flutter outline
        client:exec_cmd({
          command = 'dart.showFlutterOutline',
          arguments = {},
        }, { bufnr = bufnr })
      end,
      vim.tbl_extend('force', opts, {
        desc = 'Flutter: Show outline',
      })
    )

    -- Widget shortcuts
    vim.keymap.set(
      'n',
      '<leader>zw',
      function()
        -- Wrap with widget
        vim.lsp.buf.code_action({
          filter = function(action) return action.title and action.title:match('Wrap with widget') end,
          apply = true,
        })
      end,
      vim.tbl_extend('force', opts, {
        desc = 'Flutter: Wrap with widget',
      })
    )

    vim.keymap.set(
      'n',
      '<leader>zx',
      function()
        -- Extract widget
        vim.lsp.buf.code_action({
          filter = function(action) return action.title and action.title:match('Extract widget') end,
          apply = true,
        })
      end,
      vim.tbl_extend('force', opts, {
        desc = 'Flutter: Extract widget',
      })
    )

    -- Enable inlay hints if supported
    if client.server_capabilities.inlayHintProvider then
      vim.lsp.inlay_hint.enable(true, {
        bufnr = bufnr,
      })
    end

    -- Format on save is handled by conform.nvim (lsp_format fallback with an
    -- empty formatter list for dart → LSP formatting; single formatter path).
  end,

  -- Custom handlers for Flutter-specific features
  handlers = {
    -- Custom handler for Flutter outline
    ['dart/textDocument/publishFlutterOutline'] = function(err, result, ctx, config)
      if result then
        -- Handle Flutter outline display
        -- This could be integrated with aerial.nvim or other outline plugins
        vim.notify('Flutter outline updated', vim.log.levels.DEBUG)
      end
    end,

    -- Custom handler for closing labels
    ['dart/textDocument/publishClosingLabels'] = function(err, result, ctx, config)
      if result then
        -- Handle closing labels for Flutter widgets
        -- These help identify which widget closing braces belong to
        vim.notify('Flutter closing labels updated', vim.log.levels.DEBUG)
      end
    end,
  },
}
