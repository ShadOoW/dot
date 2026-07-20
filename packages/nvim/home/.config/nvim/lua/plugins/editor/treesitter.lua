-- Treesitter configuration
return {
  'nvim-treesitter/nvim-treesitter',
  build = ':TSUpdate',
  event = 'BufReadPost',
  dependencies = {
    'nvim-treesitter/nvim-treesitter-textobjects',
    'nvim-treesitter/nvim-treesitter-context',
    'windwp/nvim-ts-autotag',
  },
  opts = {
    -- Enhanced language support for modern web development
    ensure_installed = { -- Web Development Core
      'html',
      'css',
      'scss',
      'javascript',
      'typescript',
      'tsx',
      'jsdoc', -- Modern Web Frameworks
      'astro',
      'svelte',
      'vue', -- Styling & Templates
      'json',
      'json5',
      'jsonc',
      'yaml',
      'toml',
      'xml', -- Documentation & Markup
      'markdown',
      'markdown_inline', -- Programming Languages
      'lua',
      'luadoc',
      'luap',
      'java',
      'c',
      'cpp',
      'rust',
      'go',
      'python',
      'php',
      'ruby',
      'dart', -- Flutter/Dart support
      'odin', -- Shell & Config
      'bash',
      'fish',
      'dockerfile',
      'vim',
      'vimdoc',
      'regex',
      'gitignore',
      'gitcommit',
      'git_config',
      'git_rebase',
      -- Build Tools & Package Managers
      'make',
      'cmake', -- Data & Query Languages
      'sql',
      'graphql', -- Specialized
      'http', -- REST client (.http files, kulala.nvim)
      'diff',
      'comment',
    },
    auto_install = true,

    -- Enhanced highlighting
    highlight = {
      enable = true,
      use_languagetree = true,
      additional_vim_regex_highlighting = { 'markdown' },
      disable = function(lang, buf)
        local max_filesize = 100 * 1024 -- 100 KB
        local ok, stats = pcall(vim.uv.fs_stat, vim.api.nvim_buf_get_name(buf))
        if ok and stats and stats.size > max_filesize then return true end
      end,
    },

    -- Enhanced indentation
    indent = {
      enable = true,
      disable = { 'python', 'yaml' }, -- These have issues with treesitter indent
    },

    -- Enhanced text objects
    textobjects = {
      select = {
        enable = true,
        lookahead = true,
        keymaps = {
          ['af'] = '@function.outer',
          ['if'] = '@function.inner',
          ['ac'] = '@class.outer',
          ['ic'] = '@class.inner',
          ['aa'] = '@parameter.outer',
          ['ia'] = '@parameter.inner',
          ['ai'] = '@conditional.outer',
          ['ii'] = '@conditional.inner',
          ['al'] = '@loop.outer',
          ['il'] = '@loop.inner',
          ['ab'] = '@block.outer',
          ['ib'] = '@block.inner',
          ['as'] = '@statement.outer',
          ['is'] = '@statement.inner',
          ['ad'] = '@comment.outer',
          ['id'] = '@comment.inner',
          ['am'] = '@call.outer',
          ['im'] = '@call.inner',
        },
      },
      move = {
        enable = true,
        set_jumps = true,
        goto_next_start = {
          [']f'] = '@function.outer',
          [']c'] = '@class.outer',
          [']a'] = '@parameter.inner',
          [']i'] = '@conditional.outer',
          [']l'] = '@loop.outer',
          [']s'] = '@statement.outer',
          [']m'] = '@call.outer',
        },
        goto_next_end = {
          [']F'] = '@function.outer',
          [']C'] = '@class.outer',
          [']A'] = '@parameter.inner',
          [']I'] = '@conditional.outer',
          [']L'] = '@loop.outer',
          [']S'] = '@statement.outer',
          [']M'] = '@call.outer',
        },
        goto_previous_start = {
          ['[f'] = '@function.outer',
          ['[c'] = '@class.outer',
          ['[a'] = '@parameter.inner',
          ['[i'] = '@conditional.outer',
          ['[l'] = '@loop.outer',
          ['[s'] = '@statement.outer',
          ['[m'] = '@call.outer',
        },
        goto_previous_end = {
          ['[F'] = '@function.outer',
          ['[C'] = '@class.outer',
          ['[A'] = '@parameter.inner',
          ['[I'] = '@conditional.outer',
          ['[L'] = '@loop.outer',
          ['[S'] = '@statement.outer',
          ['[M'] = '@call.outer',
        },
      },
      swap = {
        enable = true,
        swap_next = {
          ['<leader><Down>'] = '@parameter.inner',
        },
        swap_previous = {
          ['<leader><Up>'] = '@parameter.inner',
        },
      },
      lsp_interop = {
        enable = true,
        border = 'single',
        peek_definition_code = {
          ['<leader>cp'] = '@function.outer',
          ['<leader>cP'] = '@class.outer',
        },
      },
    },

    -- Enhanced incremental selection with intuitive keymaps
    incremental_selection = {
      enable = true,
      keymaps = {
        init_selection = '<CR>', -- Enter to start selection
        node_incremental = '<CR>', -- Enter to expand selection
        scope_incremental = '<S-CR>', -- Shift+Enter for scope
        node_decremental = '<BS>', -- Backspace to shrink selection
      },
    },

    -- Enhanced matching
    matchup = {
      enable = true,
    },
  },

  config = function(_, opts)
    opts.install_dir = require('utils.paths').cache_path('site')
    require('nvim-treesitter').setup(opts)

    -- Configure treesitter context
    require('treesitter-context').setup({
      enable = true,
      max_lines = 3,
      min_window_height = 0,
      line_numbers = true,
      multiline_threshold = 1,
      trim_scope = 'outer',
      mode = 'cursor',
      separator = nil,
      zindex = 20,
      on_attach = function(buf)
        -- Only enable for real files with parsers
        local ft = vim.bo[buf].filetype
        if
          ft == ''
          or vim.tbl_contains({
            'qf',
            'help',
            'netrw',
            'lazy',
            'fzf',
          }, ft)
        then
          return false
        end
      end,
    })

    -- The buffer that triggered this load (BufReadPost) had its FileType
    -- event fire *before* nvim-treesitter was available, so treesitter's
    -- FileType handler was never called for it.  Re-fire FileType now so
    -- nvim-treesitter's handler picks it up via its own parser-path machinery.
    vim.schedule(function()
      local buf = vim.api.nvim_get_current_buf()
      if vim.bo[buf].filetype == '' then return end
      local ok, stats = pcall(vim.uv.fs_stat, vim.api.nvim_buf_get_name(buf))
      if ok and stats and stats.size > 100 * 1024 then return end
      vim.api.nvim_exec_autocmds('FileType', { buffer = buf, modeline = false })
    end)

    -- Configure autotag with new API
    require('nvim-ts-autotag').setup({
      opts = {
        -- Defaults
        enable_close = true, -- Auto close tags
        enable_rename = true, -- Auto rename pairs of tags
        enable_close_on_slash = true, -- Auto close on trailing </
      },
      -- Also override individual filetype configs, these take priority.
      -- Empty by default, useful if one of the "opts" global settings
      -- doesn't work well in a specific filetype
      per_filetype = {
        ['html'] = {
          enable_close = true,
          enable_rename = true,
          enable_close_on_slash = true,
        },
      },
    })
  end,
}
