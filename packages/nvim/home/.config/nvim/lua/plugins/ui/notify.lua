-- Enhanced notification backend using nvim-notify
-- Provides beautiful, customizable notifications with shared palette styling
return {
  'rcarriga/nvim-notify',
  event = 'VeryLazy',
  config = function()
    local notify = require('notify')
    local palette = require('utils.palette')

    -- Configure notify: passive (panel-first model; popups only for critical errors)
    notify.setup({
      stages = 'static',
      timeout = false,
      max_height = function() return math.floor(vim.o.lines * 0.75) end,
      max_width = function() return math.floor(vim.o.columns * 0.75) end,
      minimum_width = 50,

      -- Layout and positioning
      background_colour = palette.base,
      fps = 60,
      level = 2,

      -- Rendering options
      render = 'wrapped-compact',

      -- Top-down notification stacking
      top_down = true,

      -- Icons for different log levels
      icons = {
        ERROR = ' ',
        WARN = ' ',
        INFO = ' ',
        DEBUG = ' ',
        TRACE = ' ',
      },

      -- Time format
      time_formats = {
        notification = '%T',
        notification_history = '%FT%T',
      },

      -- Notification window styling
      on_open = function(win)
        vim.api.nvim_win_set_config(win, {
          zindex = 100,
        })

        -- Set window-specific highlight groups
        vim.wo[win].winhl = 'Normal:NotifyBackground,FloatBorder:NotifyBorder'
      end,

      -- Custom highlight groups
      highlight = {
        error = 'NotifyERROR',
        warn = 'NotifyWARN',
        info = 'NotifyINFO',
        debug = 'NotifyDEBUG',
        trace = 'NotifyTRACE',
      },
    })

    -- Set up highlight groups from the shared palette
    local function setup_highlights()
      -- Base notification colors
      vim.api.nvim_set_hl(0, 'NotifyBackground', {
        fg = palette.text,
        bg = palette.base,
      })
      local bg_dark = palette.tn_bg_dark
      vim.api.nvim_set_hl(0, 'NotifyBorder', {
        fg = palette.blue,
        bg = bg_dark,
      })

      -- Level-specific colors
      vim.api.nvim_set_hl(0, 'NotifyERROR', {
        fg = palette.red,
        bg = palette.base,
      })
      vim.api.nvim_set_hl(0, 'NotifyWARN', {
        fg = palette.yellow,
        bg = palette.base,
      })
      vim.api.nvim_set_hl(0, 'NotifyINFO', {
        fg = palette.blue,
        bg = palette.base,
      })
      vim.api.nvim_set_hl(0, 'NotifyDEBUG', {
        fg = palette.overlay,
        bg = palette.base,
      })
      vim.api.nvim_set_hl(0, 'NotifyTRACE', {
        fg = palette.overlay,
        bg = palette.base,
      })

      -- Border colors for different levels (solid backgrounds)
      vim.api.nvim_set_hl(0, 'NotifyERRORBorder', {
        fg = palette.red,
        bg = bg_dark,
      })
      vim.api.nvim_set_hl(0, 'NotifyWARNBorder', {
        fg = palette.yellow,
        bg = bg_dark,
      })
      vim.api.nvim_set_hl(0, 'NotifyINFOBorder', {
        fg = palette.blue,
        bg = bg_dark,
      })
      vim.api.nvim_set_hl(0, 'NotifyDEBUGBorder', {
        fg = palette.overlay,
        bg = bg_dark,
      })
      vim.api.nvim_set_hl(0, 'NotifyTRACEBorder', {
        fg = palette.overlay,
        bg = bg_dark,
      })

      -- Title colors
      vim.api.nvim_set_hl(0, 'NotifyERRORTitle', {
        fg = palette.red,
        bg = palette.base,
        bold = true,
      })
      vim.api.nvim_set_hl(0, 'NotifyWARNTitle', {
        fg = palette.yellow,
        bg = palette.base,
        bold = true,
      })
      vim.api.nvim_set_hl(0, 'NotifyINFOTitle', {
        fg = palette.blue,
        bg = palette.base,
        bold = true,
      })
      vim.api.nvim_set_hl(0, 'NotifyDEBUGTitle', {
        fg = palette.overlay,
        bg = palette.base,
        bold = true,
      })
      vim.api.nvim_set_hl(0, 'NotifyTRACETitle', {
        fg = palette.overlay,
        bg = palette.base,
        bold = true,
      })

      -- Icon colors
      vim.api.nvim_set_hl(0, 'NotifyERRORIcon', {
        fg = palette.red,
        bg = palette.base,
      })
      vim.api.nvim_set_hl(0, 'NotifyWARNIcon', {
        fg = palette.yellow,
        bg = palette.base,
      })
      vim.api.nvim_set_hl(0, 'NotifyINFOIcon', {
        fg = palette.blue,
        bg = palette.base,
      })
      vim.api.nvim_set_hl(0, 'NotifyDEBUGIcon', {
        fg = palette.overlay,
        bg = palette.base,
      })
      vim.api.nvim_set_hl(0, 'NotifyTRACEIcon', {
        fg = palette.overlay,
        bg = palette.base,
      })

      -- Body text colors
      vim.api.nvim_set_hl(0, 'NotifyERRORBody', {
        fg = palette.text,
        bg = palette.base,
      })
      vim.api.nvim_set_hl(0, 'NotifyWARNBody', {
        fg = palette.text,
        bg = palette.base,
      })
      vim.api.nvim_set_hl(0, 'NotifyINFOBody', {
        fg = palette.text,
        bg = palette.base,
      })
      vim.api.nvim_set_hl(0, 'NotifyDEBUGBody', {
        fg = palette.subtext,
        bg = palette.base,
      })
      vim.api.nvim_set_hl(0, 'NotifyTRACEBody', {
        fg = palette.subtext,
        bg = palette.base,
      })
    end

    -- Apply highlights immediately and on colorscheme change
    setup_highlights()
    vim.api.nvim_create_autocmd('ColorScheme', {
      callback = setup_highlights,
    })

    -- Don't replace vim.notify - let Noice handle notifications through its notify config
    -- This prevents duplicate notification panels

    -- Create utility functions for notification management
    -- (nvim-notify has no per-id dismiss, so no dismiss-by-criteria machinery here)
    _G.notification_utils = {
      -- Get notification history with filtering
      get_history = function(filters)
        filters = filters or {}
        local history = notify.history()

        if filters.level then
          history = vim.tbl_filter(function(notif) return notif.level == filters.level end, history)
        end

        if filters.since then
          local since_time = os.time() - filters.since
          history = vim.tbl_filter(function(notif) return notif.time and notif.time >= since_time end, history)
        end

        return history
      end,

      -- Count notifications by severity
      count_by_severity = function(since_seconds)
        since_seconds = since_seconds or 300 -- Default 5 minutes
        local history = notify.history()
        local counts = {
          error = 0,
          warn = 0,
          info = 0,
          debug = 0,
          trace = 0,
        }
        local current_time = os.time()

        -- Create reverse lookup for log levels
        local level_names = {}
        for name, level in pairs(vim.log.levels) do
          level_names[level] = name:lower()
        end

        for _, notif in ipairs(history) do
          if notif.time and notif.level and not notif.dismissed then
            local age = current_time - notif.time
            if age <= since_seconds then
              local level_name = level_names[notif.level]
              if level_name and counts[level_name] then counts[level_name] = counts[level_name] + 1 end
            end
          end
        end

        return counts
      end,
    }

    -- Create autocmd to emit custom event for lualine integration
    vim.api.nvim_create_autocmd('User', {
      pattern = 'NotifyBackground',
      callback = function()
        vim.schedule(function() vim.cmd('redrawstatus') end)
      end,
    })
  end,
}
