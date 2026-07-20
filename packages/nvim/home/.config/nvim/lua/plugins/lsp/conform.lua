return {
  'stevearc/conform.nvim',
  event = 'BufWritePre',
  dependencies = { 'williamboman/mason.nvim' },
  opts = {
    format_on_save = function(bufnr)
      -- Disable with a global or buffer-local variable
      if vim.g.disable_autoformat or vim.b[bufnr].disable_autoformat then return end

      local filetype = vim.bo[bufnr].filetype
      -- Use LSP formatting for Odin files
      if filetype == 'odin' then return {
        timeout_ms = 5000,
        lsp_format = 'prefer',
      } end

      -- Use rust-analyzer (rustfmt) for Rust files
      if filetype == 'rust' then return {
        timeout_ms = 10000,
        lsp_format = 'prefer',
      } end

      -- For JS/TS, use direct npx eslint after save (async, non-blocking)
      if
        vim.tbl_contains(
          { 'javascript', 'javascriptreact', 'typescript', 'typescriptreact', 'vue', 'svelte' },
          filetype
        )
      then
        local filename = vim.api.nvim_buf_get_name(bufnr)
        if filename and filename ~= '' then
          local dir = vim.fn.fnamemodify(filename, ':p:h')
          local bufnr = bufnr
          -- Run eslint asynchronously and show output
          local job = vim.fn.jobstart(
            string.format(
              'cd %s && npx eslint --fix %s 2>&1; echo exit:$?',
              vim.fn.shellescape(dir),
              vim.fn.shellescape(filename)
            ),
            {
              on_stdout = function(_, data)
                vim.schedule(
                  function() vim.notify(table.concat(data, '\n'), vim.log.levels.INFO, { title = 'ESLint' }) end
                )
              end,
              on_exit = function()
                vim.schedule(function()
                  vim.cmd('silent! edit!')
                  vim.diagnostic.reset(nil, bufnr)
                  pcall(require('lint').try_lint)
                end)
              end,
            }
          )
        end
        return -- Skip conform's own formatting
      end

      -- Default: use formatters
      return {
        timeout_ms = 15000,
        lsp_format = 'fallback',
        async = false,
      }
    end,
    formatters_by_ft = {
      -- Web Development - JavaScript/TypeScript (eslint - uses project config)
      javascript = { 'eslint' },
      javascriptreact = { 'eslint' },
      typescript = { 'eslint' },
      typescriptreact = { 'eslint' },
      vue = { 'eslint' },
      svelte = { 'eslint' },

      -- Web Development - HTML/CSS (prettierd only)
      html = { 'prettierd' },
      css = { 'prettierd' },
      scss = { 'prettierd' },
      less = { 'prettierd' },

      -- Modern Web Frameworks (prettierd only)
      astro = { 'prettierd' },

      -- Data & Config (prettierd for supported formats)
      json = { 'prettierd' },
      jsonc = { 'prettierd' },
      json5 = { 'prettierd' },
      yaml = { 'prettierd' },
      yml = { 'prettierd' },
      toml = { 'taplo' },
      xml = { 'xmlformat', 'prettierd' },

      -- REST client (.http / .rest files, kulala.nvim) — needs the `kulala-fmt`
      -- CLI on PATH (see mason-tool-installer / :MasonInstall kulala-fmt).
      http = { 'kulala-fmt' },

      -- Documentation (prettierd only)
      -- markdown = { 'prettierd' },
      mdx = { 'prettierd' },

      -- Lua (stylua specialized)
      lua = { 'stylua' },

      -- Python: ruff handles both import sorting (replaces isort) and formatting
      -- (black-compatible output). Much faster than running black + isort separately.
      python = { 'ruff_organize_imports', 'ruff_format' },

      -- Shell (specialized formatter)
      sh = { 'shfmt' },
      bash = { 'shfmt' },
      zsh = { 'shfmt' },

      -- Go (specialized formatters)
      go = { 'gofumpt', 'goimports' },

      -- Rust (use LSP formatting via rust-analyzer)
      rust = {},

      -- C/C++ (specialized formatter)
      c = { 'clang-format' },
      cpp = { 'clang-format' },

      -- SQL (specialized formatter)
      sql = { 'sql-formatter' },

      -- Docker (prettierd)
      dockerfile = { 'prettierd' },

      -- Odin (using LSP formatting via OLS with ols.json config)
      -- odin = {'odinfmt'}

      -- Dart/Flutter (using LSP formatting for best integration)
      dart = {}, -- Use LSP formatting (dartls handles this)
    },

    formatters = {
      -- Enhanced Prettier daemon for speed and consistency
      prettierd = {
        env = {
          PRETTIERD_DEFAULT_CONFIG = vim.fn.expand('~/.config/prettierd/.prettierrc.json'),
          NODE_PATH = vim.fn.expand('~/.config/prettierd/node_modules'),
        },
      },

      -- Biome for fast JS/TS formatting (alternative)
      biome = {
        command = 'biome',
        args = { 'format', '--stdin-file-path', '$FILENAME' },
        stdin = true,
      },

      -- ESLint via npx (uses project config automatically)
      eslint = {
        command = 'npx',
        args = { 'eslint', '--fix', '$FILENAME' },
        stdin = false,
        cwd = function(ctx) return ctx.dirname end,
      },

      -- Tailwind class sorting
      rustywind = {
        command = 'rustywind',
        args = { '--stdin' },
        stdin = true,
      },

      -- Enhanced stylua for Lua
      stylua = {
        prepend_args = {
          '--indent-type',
          'Spaces',
          '--indent-width',
          '2',
          '--quote-style',
          'ForceSingle',
          '--collapse-simple-statement',
          'Always',
          '--call-parentheses',
          'Always',
        },
        -- Add condition to check if stylua is available
        condition = function(self, ctx) return vim.fn.executable('stylua') == 1 end,
      },

      -- Shell formatting
      shfmt = {
        prepend_args = { '-i', '2', '-bn', '-ci', '-sr' },
      },

      -- Go formatting
      gofumpt = {
        command = 'gofumpt',
        args = { '-w', '$FILENAME' },
        stdin = false,
      },

      goimports = {
        command = 'goimports',
        args = { '-w', '$FILENAME' },
        stdin = false,
      },

      -- SQL formatting
      ['sql-formatter'] = {
        command = 'sql-formatter',
        args = { '--language', 'postgresql', '--tab-width', '2', '--keyword-case', 'upper' },
        stdin = true,
      },

      -- C/C++ formatting
      ['clang-format'] = {
        prepend_args = { '--style=Google' },
      },

      -- XML formatting
      xmlformat = {
        command = 'xmlformat',
        args = { '--indent', '2', '--preserve', 'literal' },
        stdin = true,
      },

      -- TOML formatting
      taplo = {
        command = 'taplo',
        args = { 'format', '-' },
        stdin = true,
      },

      -- Odin formatting (handled by OLS LSP server)
      -- odinfmt = {
      --     command = 'odinfmt',
      --     args = {'--stdin'},
      --     stdin = true,
      --     condition = function(self, ctx)
      --         return vim.fn.executable('odinfmt') == 1
      --     end
      -- }
    },

    -- Custom format options
    format_after_save = function(bufnr)
      -- Auto-sort Tailwind classes after save
      local ft = vim.bo[bufnr].filetype
      if
        vim.tbl_contains(
          { 'html', 'css', 'javascript', 'typescript', 'javascriptreact', 'typescriptreact', 'vue', 'svelte', 'astro' },
          ft
        )
      then
        local conform = require('conform')
        conform.format({
          bufnr = bufnr,
          formatters = { 'rustywind' },
          quiet = true,
        })
      end
    end,
  },

  config = function(_, opts)
    local conform = require('conform')
    conform.setup(opts)

    -- Enhanced keymaps
    vim.keymap.set({ 'n', 'v' }, '<leader>ff', function()
      local filename = vim.fn.expand('%:p')
      local dir = vim.fn.expand('%:p:h')
      local bufnr = vim.api.nvim_get_current_buf()
      vim.fn.jobstart(
        string.format('cd %s && npx eslint --fix %s 2>&1', vim.fn.shellescape(dir), vim.fn.shellescape(filename)),
        {
          on_exit = function()
            vim.schedule(function()
              vim.cmd('silent! edit!')
              vim.diagnostic.reset(nil, bufnr)
              pcall(require('lint').try_lint)
              vim.cmd('echo "Formatted with eslint"')
            end)
          end,
        }
      )
    end, {
      desc = 'Format with eslint',
    })

    -- Debug: run eslint directly and show output
    vim.keymap.set('n', '<leader>fe', function()
      local filename = vim.fn.expand('%:p') -- absolute path
      local cmd = string.format(
        'cd %s && npx eslint %s 2>&1',
        vim.fn.shellescape(vim.fn.expand('%:p:h')),
        vim.fn.shellescape(filename)
      )
      local output = vim.fn.system(cmd)
      vim.notify(output, vim.log.levels.INFO, { title = 'ESLint Output' })
    end, { desc = 'Run eslint and show output' })

    -- Format with a specific formatter.
    -- Runs synchronously so the result is never silently dropped (async format
    -- discards its output if anything touches the buffer mid-run), skips the
    -- picker when only one formatter applies, and reports the outcome.
    vim.keymap.set({ 'n', 'v' }, '<leader>fF', function()
      local bufnr = vim.api.nvim_get_current_buf()
      local formatters = conform.list_formatters(bufnr)
      if #formatters == 0 then
        require('utils.notify').warn('Conform', 'No formatters available for this buffer')
        return
      end

      local function run(choice)
        conform.format({
          formatters = { choice },
          bufnr = bufnr,
          async = false, -- sync: never silently discarded by a mid-run buffer change
          lsp_format = 'never',
          timeout_ms = 10000,
        }, function(err, did_edit)
          if err then
            require('utils.notify').error('Conform', choice .. ': ' .. tostring(err))
          elseif did_edit then
            require('utils.notify').success('Conform', 'Formatted with ' .. choice)
          else
            require('utils.notify').info('Conform', choice .. ': already formatted (no changes)')
          end
        end)
      end

      if #formatters == 1 then
        run(formatters[1].name)
        return
      end

      local formatter_names = vim.tbl_map(function(f) return f.name end, formatters)
      vim.ui.select(formatter_names, {
        prompt = 'Select a formatter to use for this buffer:',
      }, function(choice)
        if choice then run(choice) end
      end)
    end, {
      desc = 'Format (pick formatter)',
    })

    -- Toggle format on save
    vim.keymap.set('n', '<leader>ef', function()
      if vim.g.disable_autoformat or vim.b.disable_autoformat then
        vim.g.disable_autoformat = false
        vim.b.disable_autoformat = false
        require('utils.notify').success('Conform', 'Format on save enabled')
      else
        vim.g.disable_autoformat = true
        require('utils.notify').info('Conform', 'Format on save disabled')
      end
    end, {
      desc = 'Toggle format on save',
    })

    -- Command to show available formatters
    vim.api.nvim_create_user_command('ConformInfo', function()
      local formatters = conform.list_formatters()
      if #formatters == 0 then
        print('No formatters available for this buffer')
        return
      end

      print('Available formatters for ' .. vim.bo.filetype .. ':')
      for _, formatter in ipairs(formatters) do
        local status = formatter.available and '✓' or '✗'
        print(string.format('  %s %s', status, formatter.name))
      end
    end, {
      desc = 'Show available formatters',
    })
  end,
}
