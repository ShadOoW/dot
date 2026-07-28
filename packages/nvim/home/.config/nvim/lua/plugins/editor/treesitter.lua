-- Treesitter configuration
-- Tracks the rewritten 'main' branch, which has no module system: highlighting,
-- indentation, incremental selection and the matchup integration are each wired
-- up explicitly.  Textobjects live in plugins/editor/treesitter-textobjects.lua,
-- matchup's globals in plugins/ui/matchparen.lua.
local ensure_installed = { -- Web Development Core
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
  -- no 'jsonc' parser on 'main'; the plugin registers jsonc -> json instead
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
}

-- Treesitter indentation is still flagged experimental upstream; for these two
-- the built-in indentexpr behaves better.
local indent_disabled = { python = true, yaml = true }

-- Filetypes that also want the vim regex syntax layered on top; the rewrite has
-- no `additional_vim_regex_highlighting`, so set 'syntax' directly.
local regex_highlight = { markdown = true }

local MAX_FILESIZE = 100 * 1024

---@param buf integer
---@return boolean
local function oversized(buf)
  local ok, stats = pcall(vim.uv.fs_stat, vim.api.nvim_buf_get_name(buf))
  return (ok and stats and stats.size > MAX_FILESIZE) or false
end

return {
  'nvim-treesitter/nvim-treesitter',
  branch = 'main',
  -- The rewrite prepends its install_dir to 'runtimepath' during setup() and
  -- explicitly does not support lazy-loading.
  lazy = false,
  build = ':TSUpdate',
  dependencies = {
    'nvim-treesitter/nvim-treesitter-context',
    'windwp/nvim-ts-autotag',
  },

  config = function()
    local ts = require('nvim-treesitter')

    -- Parsers are compiled artifacts, so keep them with the other regenerable
    -- caches instead of in stdpath('data').
    ts.setup({ install_dir = require('utils.paths').cache_path('treesitter') })

    -- Incremental selection, reimplemented since the rewrite dropped the module.
    -- Kept buffer-local so <CR> keeps its normal meaning in quickfix, help and
    -- other windows without a parser.
    ---@param buf integer
    local function map_incremental(buf)
      local incremental = require('utils.ts_incremental')
      local map = function(mode, lhs, rhs, desc) vim.keymap.set(mode, lhs, rhs, { buffer = buf, desc = desc }) end
      map('n', '<CR>', incremental.init_selection, 'Treesitter: start selection')
      map('x', '<CR>', incremental.node_incremental, 'Treesitter: expand selection')
      map('x', '<S-CR>', incremental.scope_incremental, 'Treesitter: expand to scope')
      map('x', '<BS>', incremental.node_decremental, 'Treesitter: shrink selection')
    end

    ---@param buf integer
    ---@param lang string
    local function enable(buf, lang)
      if not vim.api.nvim_buf_is_valid(buf) then return end

      pcall(vim.treesitter.start, buf, lang)
      if regex_highlight[vim.bo[buf].filetype] then vim.bo[buf].syntax = 'ON' end
      if not indent_disabled[lang] then vim.bo[buf].indentexpr = 'v:lua.require\'nvim-treesitter\'.indentexpr()' end
      map_incremental(buf)
    end

    ---@param buf integer
    local function attach(buf)
      local lang = vim.treesitter.language.get_lang(vim.bo[buf].filetype)
      if not lang or oversized(buf) then return end

      -- `language.add` resolves against the whole runtimepath, so this covers
      -- both parsers this plugin installed (its install_dir is prepended, and
      -- so wins) and any the distro ships -- `get_installed` would miss those.
      if vim.treesitter.language.add(lang) then
        enable(buf, lang)
      elseif vim.list_contains(ts.get_available(), lang) then
        -- Stand-in for master's `auto_install`: fetch on first sight, then light
        -- the buffer up once the parser has actually landed.
        ts.install({ lang }):await(function(err)
          if err then return end
          vim.schedule(function() enable(buf, lang) end)
        end)
      end
    end

    vim.api.nvim_create_autocmd('FileType', {
      group = vim.api.nvim_create_augroup('user_treesitter', { clear = true }),
      callback = function(ev) attach(ev.buf) end,
    })

    --- Attach to buffers whose FileType already fired -- during a session
    --- restore, or before a parser finished building.
    local function sweep_buffers()
      for _, buf in ipairs(vim.api.nvim_list_bufs()) do
        if vim.api.nvim_buf_is_loaded(buf) and vim.bo[buf].filetype ~= '' then attach(buf) end
      end
    end

    local installed = {} ---@type table<string, boolean>
    for _, lang in ipairs(ts.get_installed('parsers')) do
      installed[lang] = true
    end

    local missing = vim.tbl_filter(function(lang) return not installed[lang] end, ensure_installed)
    if #missing > 0 then ts.install(missing):await(vim.schedule_wrap(sweep_buffers)) end

    vim.schedule(sweep_buffers)

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

    -- nvim-ts-autotag is configured in plugins/editor/autotag.lua
  end,
}
