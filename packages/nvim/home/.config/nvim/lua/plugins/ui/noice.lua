-- Enhanced notification and message system using noice.nvim
-- Provides minimal distraction with intelligent routing and filtering
return {
  'folke/noice.nvim',
  event = 'VeryLazy',
  dependencies = { 'MunifTanjim/nui.nvim', 'rcarriga/nvim-notify' },
  opts = {
    -- Use nvim-notify as the notification backend
    backend = 'notify',
    lsp = {
      override = {
        ['vim.lsp.util.convert_input_to_markdown_lines'] = true,
        ['vim.lsp.util.stylize_markdown'] = true,
        ['cmp.entry.get_documentation'] = true,
      },
      hover = {
        enabled = true,
        silent = false,
      },
      signature = {
        enabled = true,
        auto_open = {
          enabled = true,
          trigger = true,
          throttle = 50,
        },
      },
      progress = {
        enabled = true,
        format = 'lsp_progress',
        format_done = 'lsp_progress_done',
        throttle = 1000 / 30,
        view = 'mini',
      },
      message = {
        enabled = true,
        view = 'mini',
        opts = {},
      },
      documentation = {
        view = 'hover',
        opts = {
          lang = 'markdown',
          replace = true,
          render = 'plain',
          format = { '{message}' },
          win_options = {
            concealcursor = 'n',
            conceallevel = 3,
          },
        },
      },
    },
    -- Presets for common use cases
    presets = {
      bottom_search = true, -- use a classic bottom cmdline for search
      command_palette = false, -- position the cmdline and popupmenu together
      long_message_to_split = true, -- long messages will be sent to a split
      inc_rename = false, -- enables an input dialog for inc-rename.nvim
      lsp_doc_border = false, -- add a border to hover docs and signature help
    },
    -- Message routing: mini only for LSP; notifications -> panel (opens/updates on new message)
    routes = { -- Search noise: skip
      {
        filter = {
          any = {
            {
              find = 'search hit',
            },
            {
              find = 'Pattern not found',
            },
            {
              find = 'Already at',
            },
          },
        },
        opts = {
          skip = true,
        },
      }, -- Yank/write: skip
      {
        filter = {
          any = {
            {
              find = 'written',
            },
            {
              find = 'yanked',
            },
            {
              find = 'lines changed',
            },
          },
        },
        opts = {
          skip = true,
        },
      }, -- Skip generic E37 (Neovim also emits E162 with buffer name; keep E162 only)
      {
        filter = {
          find = 'E37: No write since last change',
        },
        opts = {
          skip = true,
        },
      }, -- E162 (qall with unsaved + buffer name) -> panel
      {
        filter = {
          any = {
            {
              find = 'No write since last change',
            },
            {
              find = 'E162:',
            },
          },
        },
        view = 'notify_panel',
      }, -- Errors, notify, msg_show -> panel
      {
        filter = {
          kind = 'error',
        },
        view = 'notify_panel',
      },
      {
        filter = {
          event = 'notify',
        },
        view = 'notify_panel',
      },
      {
        filter = {
          event = 'msg_show',
        },
        view = 'notify_panel',
      }, -- Cmdline
      {
        filter = {
          event = 'cmdline',
          kind = ':',
        },
        view = 'cmdline',
      },
    },
    -- Command line configuration
    cmdline = {
      enabled = true,
      view = 'cmdline',
      opts = {},
      format = {
        cmdline = {
          pattern = '^:',
          icon = '',
          lang = 'vim',
        },
        search_down = {
          kind = 'search',
          pattern = '^/',
          icon = '󱈆',
          lang = 'regex',
        },
        search_up = {
          kind = 'search',
          pattern = '^%?',
          icon = '󱈆',
          lang = 'regex',
        },
        filter = {
          pattern = '^:%s*!',
          icon = '󰈲',
          lang = 'bash',
        },
        lua = {
          pattern = { '^:%s*lua%s+', '^:%s*lua%s*=%s*', '^:%s*=%s*' },
          icon = '',
          lang = 'lua',
        },
        help = {
          pattern = '^:%s*he?l?p?%s+',
          icon = '󰋗',
        },
        input = {},
      },
    },
    -- Messages: panel for notifications; mini only for LSP (in lsp config)
    messages = {
      enabled = true,
      view = 'notify_panel',
      view_error = 'notify_panel',
      view_warn = 'notify_panel',
      view_history = 'notify_panel',
      view_search = 'virtualtext',
    },
    -- Popup menu configuration (disable to avoid conflicts)
    popupmenu = {
      enabled = false,
    },
    -- Notify: panel (opens/updates on new notification)
    notify = {
      enabled = true,
      view = 'notify_panel',
    },
    -- Commands: history and errors use panel
    commands = {
      history = {
        view = 'notify_panel',
        opts = {
          enter = false,
          format = 'details',
        },
      },
      errors = {
        view = 'notify_panel',
        opts = {
          enter = false,
          format = 'details',
        },
      },
    },
    -- View configurations
    views = {
      popupmenu = {
        relative = 'editor',
        position = {
          row = 8,
          col = '50%',
        },
        size = {
          width = 60,
          height = 10,
        },
        border = {
          style = 'rounded',
          padding = { 0, 1 },
        },
        win_options = {
          winhighlight = 'Normal:Normal,FloatBorder:DiagnosticInfo',
        },
      },
      hover = {
        border = {
          style = 'rounded',
        },
        position = {
          row = 2,
          col = 2,
        },
        win_options = {
          winhighlight = 'Normal:Normal,FloatBorder:DiagnosticInfo',
        },
      },
      popup = {
        border = {
          style = 'rounded',
        },
        position = '50%',
        size = {
          width = 60,
          height = 20,
        },
        win_options = {
          winhighlight = 'Normal:Normal,FloatBorder:DiagnosticInfo',
        },
      },
      split = {
        enter = true,
        size = '33%',
        win_options = {
          winhighlight = 'Normal:Normal',
        },
      },
      notify_panel = {
        view = 'split',
        position = 'bottom',
        size = '20%',
        enter = false,
        format = 'details',
        scrollbar = false,
        win_options = {
          wrap = true,
          number = false,
          relativenumber = false,
          signcolumn = 'no',
          winbar = '',
          winhighlight = 'Normal:NoiceSplit,FloatBorder:NoiceSplitBorder',
        },
        close = {
          keys = { 'q' },
        },
      },
      mini = {
        position = {
          row = -2,
          col = '100%',
        },
        size = {
          width = 'auto',
          height = 'auto',
        },
        border = {
          style = 'none',
        },
        win_options = {
          winhighlight = 'Normal:NoiceMini',
        },
      },
    },
    -- Custom format for messages
    format = {
      level = {
        icons = {
          error = ' ',
          warn = ' ',
          info = ' ',
          debug = ' ',
          trace = ' ',
        },
      },
      lsp_progress = { '{progress} {data.progress.message}' },
      lsp_progress_done = { '✓ {data.progress.title}' },
    },
    -- Health check configuration
    health = {
      checker = false,
    },
  },
  config = function(_, opts)
    local palette = require('utils.palette')
    require('noice').setup(opts)

    -- Scroll noice split panel to bottom when content changes (debounced, zb-based)
    local SCROLL_DEBOUNCE_MS = 80
    local scroll_timer = nil
    local attached_bufs = {}
    local last_line_ns = vim.api.nvim_create_namespace('noice_last_line')

    local function scroll_noice_panel()
      for _, win in ipairs(vim.api.nvim_list_wins()) do
        if vim.api.nvim_win_is_valid(win) then
          local buf = vim.api.nvim_win_get_buf(win)
          if vim.bo[buf].filetype == 'noice' then
            local config = vim.api.nvim_win_get_config(win)
            if config and (config.relative == '' or config.relative == nil) then
              local line_count = vim.api.nvim_buf_line_count(buf)
              if line_count >= 1 then
                pcall(vim.api.nvim_win_call, win, function()
                  vim.api.nvim_win_set_cursor(win, { line_count, 0 })
                  vim.cmd('noautocmd silent! normal! zb')
                end)
                vim.api.nvim_buf_clear_namespace(buf, last_line_ns, 0, -1)
                vim.hl.range(buf, last_line_ns, 'NoiceLastLine', { line_count - 1, 0 }, { line_count - 1, -1 })
              end
              break
            end
          end
        end
      end
    end

    local uv = vim.uv or vim.loop
    local function schedule_scroll()
      if scroll_timer then pcall(function()
        scroll_timer:stop()
        scroll_timer:close()
      end) end
      scroll_timer = uv.new_timer()
      scroll_timer:start(
        SCROLL_DEBOUNCE_MS,
        0,
        vim.schedule_wrap(function()
          scroll_timer:stop()
          scroll_timer:close()
          scroll_timer = nil
          scroll_noice_panel()
        end)
      )
    end

    -- Attach to noice split buffers; on_lines fires when content changes
    local function maybe_attach_scroll(buf)
      if not buf or vim.bo[buf].filetype ~= 'noice' or attached_bufs[buf] then return end
      for _, win in ipairs(vim.api.nvim_list_wins()) do
        if vim.api.nvim_win_get_buf(win) == buf and vim.api.nvim_win_is_valid(win) then
          local config = vim.api.nvim_win_get_config(win)
          if config and (config.relative == '' or config.relative == nil) then
            attached_bufs[buf] = true
            vim.api.nvim_buf_attach(buf, false, {
              on_lines = schedule_scroll,
              on_detach = function() attached_bufs[buf] = nil end,
            })
            break
          end
        end
      end
    end

    -- Setup custom highlight groups with Tokyo Night colors (solid backgrounds)
    local bg_dark = palette.tn_bg_dark
    local function setup_highlights()
      vim.api.nvim_set_hl(0, 'NoiceFormatProgressDone', {
        fg = palette.green,
        bg = bg_dark,
      })
      vim.api.nvim_set_hl(0, 'NoiceFormatProgressTodo', {
        fg = palette.yellow,
        bg = bg_dark,
      })
      vim.api.nvim_set_hl(0, 'NoiceLspProgressClient', {
        fg = palette.blue,
        bg = bg_dark,
      })
      vim.api.nvim_set_hl(0, 'NoiceLspProgressTitle', {
        fg = palette.text,
        bg = bg_dark,
      })
      vim.api.nvim_set_hl(0, 'NoiceLspProgressSpinner', {
        fg = palette.yellow,
        bg = bg_dark,
      })
      vim.api.nvim_set_hl(0, 'NoiceMini', {
        fg = palette.blue,
        bg = palette.base,
      })
      vim.api.nvim_set_hl(0, 'NoiceCmdlinePopup', {
        fg = palette.text,
        bg = palette.surface0,
      })
      vim.api.nvim_set_hl(0, 'NoiceCmdlinePopupBorder', {
        fg = palette.blue,
        bg = bg_dark,
      })
      vim.api.nvim_set_hl(0, 'NoicePopup', {
        fg = palette.text,
        bg = palette.surface0,
      })
      vim.api.nvim_set_hl(0, 'NoicePopupBorder', {
        fg = palette.blue,
        bg = bg_dark,
      })
      vim.api.nvim_set_hl(0, 'NoiceSplit', {
        fg = palette.text,
        bg = palette.base,
      })
      vim.api.nvim_set_hl(0, 'NoiceSplitBorder', {
        fg = palette.blue,
        bg = bg_dark,
      })
      vim.api.nvim_set_hl(0, 'NoiceLastLine', {
        fg = 'NONE',
        bg = palette.surface0,
      })
    end

    -- Apply highlights immediately and on colorscheme change
    setup_highlights()
    vim.api.nvim_create_autocmd('ColorScheme', {
      callback = setup_highlights,
    })

    -- Truncate long messages; scroll panel when vim.notify is called
    local original_notify = vim.notify
    vim.notify = function(msg, level, opts)
      opts = opts or {}
      if type(msg) == 'string' and #msg > 500 then msg = msg:sub(1, 497) .. '...' end
      opts.title = opts.title or 'Neovim'
      original_notify(msg, level, opts)
      schedule_scroll()
    end

    -- Setup noice-specific keybindings
    local keymap = require('utils.keymap')

    -- Route through panel-manager so competing panels close when noice opens
    keymap.n('<F1>', function() require('plugins.ui.panel-manager').toggle('noice') end, 'Toggle notification panel')

    -- Auto-refresh lualine when notifications change
    local notify_group = vim.api.nvim_create_augroup('NoiceNotifyUpdate', {
      clear = true,
    })
    vim.api.nvim_create_autocmd('User', {
      pattern = 'NotifyBackground',
      group = notify_group,
      callback = function()
        vim.schedule(function() vim.cmd('redrawstatus') end)
      end,
    })

    -- BufWinEnter: attach scroll, highlight last line, remove winbar from noice split
    vim.api.nvim_create_autocmd('BufWinEnter', {
      group = notify_group,
      callback = function(args)
        maybe_attach_scroll(args.buf)
        if vim.bo[args.buf].filetype == 'noice' then
          schedule_scroll()
          -- Force winbar off for noice split (inherited winbar reserves empty top line)
          local win = vim.api.nvim_get_current_win()
          local config = vim.api.nvim_win_get_config(win)
          if config and (config.relative == '' or config.relative == nil) then
            pcall(function() vim.wo[win].winbar = '' end)
            vim.defer_fn(function()
              if vim.api.nvim_win_is_valid(win) then pcall(function() vim.wo[win].winbar = '' end) end
            end, 50)
          end
        end
      end,
    })
    vim.api.nvim_create_autocmd('BufEnter', {
      group = notify_group,
      callback = function(args)
        if vim.bo[args.buf].filetype == 'noice' then schedule_scroll() end
      end,
    })
  end,
}
