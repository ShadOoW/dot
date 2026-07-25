-- Enhanced statusline configuration
-- Provides modern, contextual status information with clean design
return {
  'nvim-lualine/lualine.nvim',
  dependencies = { 'nvim-tree/nvim-web-devicons', 'rcarriga/nvim-notify' },
  event = 'VeryLazy',
  config = function()
    local lualine = require('lualine')
    local palette = require('utils.palette')

    local function get_project_name()
      local cwd = vim.fn.getcwd()
      local project_name = vim.fn.fnamemodify(cwd, ':t')

      -- Java projects with Gradle
      if vim.fn.filereadable(cwd .. '/build.gradle') == 1 or vim.fn.filereadable(cwd .. '/settings.gradle') == 1 then
        return ' ' .. project_name
      end

      -- Java projects with Maven
      if vim.fn.filereadable(cwd .. '/pom.xml') == 1 then return ' ' .. project_name end

      -- Node.js projects
      if vim.fn.filereadable(cwd .. '/package.json') == 1 then return ' ' .. project_name end

      -- Rust projects
      if vim.fn.filereadable(cwd .. '/Cargo.toml') == 1 then return ' ' .. project_name end

      -- Python projects
      if
        vim.fn.filereadable(cwd .. '/pyproject.toml') == 1
        or vim.fn.filereadable(cwd .. '/setup.py') == 1
        or vim.fn.filereadable(cwd .. '/requirements.txt') == 1
      then
        return ' ' .. project_name
      end

      -- Git repositories
      if vim.fn.isdirectory(cwd .. '/.git') == 1 then return ' ' .. project_name end

      return ' ' .. project_name
    end

    -- Custom components
    local function buffer_count()
      -- Count all listed buffers, regardless of modified state
      local buffers = #vim.fn.getbufinfo({ buflisted = 1 })
      return string.format(' %d', buffers)
    end

    local function tab_count()
      local n = #vim.api.nvim_list_tabpages()
      if n <= 1 then return '' end
      return string.format('󰓩 %d', n)
    end

    -- Custom theme with improved contrast for better visibility
    local custom_theme = {
      normal = {
        a = {
          fg = palette.base,
          bg = palette.blue,
          gui = 'bold',
        },
        b = {
          fg = palette.text,
          bg = palette.surface1,
        },
        c = {
          fg = palette.subtext,
          bg = palette.surface0,
        },
      },
      insert = {
        a = {
          fg = palette.base,
          bg = palette.green,
          gui = 'bold',
        },
        b = {
          fg = palette.text,
          bg = palette.surface1,
        },
        c = {
          fg = palette.subtext,
          bg = palette.surface0,
        },
      },
      visual = {
        a = {
          fg = palette.base,
          bg = palette.yellow,
          gui = 'bold',
        },
        b = {
          fg = palette.text,
          bg = palette.surface1,
        },
        c = {
          fg = palette.subtext,
          bg = palette.surface0,
        },
      },
      replace = {
        a = {
          fg = palette.base,
          bg = palette.red,
          gui = 'bold',
        },
        b = {
          fg = palette.text,
          bg = palette.surface1,
        },
        c = {
          fg = palette.subtext,
          bg = palette.surface0,
        },
      },
      command = {
        a = {
          fg = palette.base,
          bg = palette.mauve,
          gui = 'bold',
        },
        b = {
          fg = palette.text,
          bg = palette.surface1,
        },
        c = {
          fg = palette.subtext,
          bg = palette.surface0,
        },
      },
      inactive = {
        a = {
          fg = palette.overlay,
          bg = palette.surface1,
        },
        b = {
          fg = palette.overlay,
          bg = palette.surface1,
        },
        c = {
          fg = palette.overlay,
          bg = palette.surface0,
        },
      },
    }

    lualine.setup({
      options = {
        theme = custom_theme,
        component_separators = {
          left = '',
          right = '',
        },
        section_separators = {
          left = '',
          right = '',
        },
        globalstatus = true,
        always_divide_middle = true,
        disabled_filetypes = {
          statusline = {},
          winbar = {},
        },
        refresh = {
          statusline = 250,
          tabline = 250,
          winbar = 250,
        },
      },
      sections = {
        lualine_a = {
          {
            'mode',
            fmt = function(str) return str:sub(1, 1) end,
          },
        },
        lualine_b = {
          buffer_count,
          tab_count,
          {
            'branch',
            icon = '',
            fmt = function(str)
              if #str > 20 then return str:sub(1, 17) .. '…' end
              return str
            end,
          },
          {
            'diff',
            symbols = {
              added = ' ',
              modified = ' ',
              removed = ' ',
            },
          },
        },
        lualine_c = {
          {
            get_project_name,
            color = {
              fg = palette.blue,
              gui = 'bold',
            },
          },
          {
            'filename',
            path = 1,
            symbols = {
              modified = ' ●',
              readonly = ' ',
              unnamed = '[No Name]',
            },
            fmt = function(str)
              -- Get current buffer info
              local bufnr = vim.api.nvim_get_current_buf()
              local buf_name = vim.api.nvim_buf_get_name(bufnr)
              local buf_type = vim.bo[bufnr].buftype
              local filetype = vim.bo[bufnr].filetype

              -- Priority 1.5: Handle trouble buffers - use filetype as primary detection
              if filetype == 'trouble' then
                -- This is definitely a trouble buffer, let's determine what type

                -- First check if we have a stored mode globally
                if _G.current_trouble_mode then
                  local mode_map = {
                    cascade = ' Diagnostics',
                    diagnostics = ' Diagnostics',
                    qflist = ' Quickfix',
                    loclist = ' Location List',
                    symbols = ' Symbols',
                    lsp_references = ' References',
                    lsp_definitions = ' Definitions',
                    lsp_type_definitions = ' Type Defs',
                    lsp_implementations = ' Implementations',
                    lsp_document_symbols = ' Symbols',
                    lsp_workspace_symbols = ' Workspace',
                  }

                  return mode_map[_G.current_trouble_mode]
                    or (' ' .. (_G.current_trouble_mode:gsub('_', ' '):gsub('^%l', string.upper)))
                end

                -- Fallback: try to detect via trouble view
                local view_ok, view = pcall(require, 'trouble.view')
                if view_ok and view.current and view.current.mode then
                  local current_mode = view.current.mode

                  -- Map trouble modes to display names
                  local mode_map = {
                    cascade = ' Diagnostics',
                    diagnostics = ' Diagnostics',
                    qflist = ' Quickfix',
                    loclist = ' Location List',
                    symbols = ' Symbols',
                    lsp_references = ' References',
                    lsp_definitions = ' Definitions',
                    lsp_type_definitions = ' Type Defs',
                    lsp_implementations = ' Implementations',
                    lsp_document_symbols = ' Symbols',
                    lsp_workspace_symbols = ' Workspace',
                  }

                  return mode_map[current_mode] or ' Trouble'
                end

                return ' Trouble'
              end

              -- Priority 2: Handle trouble buffers with buffer name patterns (fallback)
              if buf_name:match('^trouble://') or buf_name:find('trouble') then
                local trouble_type = buf_name:match('^trouble://([^/]+)')
                if trouble_type then
                  local type_map = {
                    cascade = ' Diagnostics',
                    diagnostics = ' Diagnostics',
                    qflist = ' Quickfix',
                    loclist = ' Location List',
                    symbols = ' Symbols',
                    lsp_references = ' References',
                    lsp_definitions = ' Definitions',
                    lsp_type_definitions = ' Type Defs',
                    lsp_implementations = ' Implementations',
                    lsp_document_symbols = ' Symbols',
                    lsp_workspace_symbols = ' Workspace',
                  }
                  return type_map[trouble_type] or (' ' .. trouble_type:gsub('_', ' '):gsub('^%l', string.upper))
                end
                return ' Trouble'
              end

              -- Priority 3: Oil buffers (buftype can be acwrite or nofile)
              if filetype == 'oil' then return ' Files' end

              -- Priority 4: Check for other custom buffer variables
              local custom_name = vim.b[bufnr].custom_buffer_name
              if custom_name and custom_name ~= '' then return custom_name end

              -- Priority 5: Handle special buffer types
              if buf_type == 'nofile' or buf_type == 'terminal' then
                -- Handle terminal buffers
                if buf_name:match('^term://') then return '  Terminal' end

                -- Handle other special buffers based on filetype
                local filetype_names = {
                  noice = ' Messages',
                  notify = ' Notifications',
                  oil = ' Files',
                  outputpanel = ' Output',
                  toggleterm = '  Terminal',
                }

                if filetype_names[filetype] then return filetype_names[filetype] end

                -- Handle other special buffers based on buffer name patterns
                local special_names = {
                  ['NvimTree'] = ' Files',
                  ['neo-tree'] = ' Files',
                  ['aerial'] = ' Outline',
                  ['Outline'] = ' Outline',
                  ['dapui_'] = ' Debug',
                  ['dap-repl'] = ' Debug REPL',
                  ['gitcommit'] = ' Git Commit',
                  ['fugitive://'] = ' Git',
                  ['DiffviewFiles'] = ' Git Diff',
                  ['NeogitStatus'] = ' Git Status',
                }

                for pattern, name in pairs(special_names) do
                  if buf_name:find(pattern) then return name end
                end

                -- Special handling for empty buffer names with nofile type
                if buf_name == '' and buf_type == 'nofile' then return '[Special Buffer]' end

                -- If it's a nofile buffer but no special handling, show buffer type
                if buf_type == 'nofile' then return '[' .. (buf_type:gsub('^%l', string.upper)) .. ']' end
              end

              -- Priority 5: Return original string for normal files
              return str
            end,
          },
        },
        lualine_x = {
          -- LSP progress spinner: shows activity while LSP is working (type-checking,
          -- indexing, etc.), goes quiet when idle. Replaces static client name list.
          {
            'lsp_status',
            symbols = {
              spinner = { '⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏' },
              done = '',
            },
            color = { fg = palette.blue },
          },
          {
            'diagnostics',
            sources = { 'nvim_diagnostic' },
            -- Plain ASCII prefixes — Nerd Font v3 glyphs (󰅚 󰀪) render
            -- as zero-width in many terminals, leaving bare ambiguous numbers.
            symbols = {
              error = 'E:',
              warn = 'W:',
              info = 'I:',
              hint = 'H:',
            },
            always_visible = false,
          },
        },
        lualine_y = {
          'filetype',
        },
        lualine_z = { 'progress', 'location' },
      },
      inactive_sections = {
        lualine_a = {},
        lualine_b = {},
        lualine_c = { {
          'filename',
          path = 1,
        } },
        lualine_x = { 'location' },
        lualine_y = {},
        lualine_z = {},
      },
      tabline = {},
      winbar = {},
      inactive_winbar = {},
      extensions = { 'nvim-tree', 'quickfix', 'fugitive' },
    })

    -- No manual redrawstatus autocmds needed: options.refresh (250ms) keeps
    -- the statusline current on LSP attach/detach, buffer/window changes, etc.
  end,
}
