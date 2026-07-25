-- Codeium AI completion - FREE with generous limits
return {
  'Exafunction/codeium.nvim',
  dependencies = { 'nvim-lua/plenary.nvim', 'hrsh7th/nvim-cmp' },
  event = 'InsertEnter',
  build = ':Codeium Auth',
  config = function()
    local codeium = require('codeium')
    local notify = require('utils.notify')

    -- Track enabled state (default: enabled); explicit nil check so `false` is respected
    if vim.g.codeium_enabled == nil then vim.g.codeium_enabled = true end

    codeium.setup({
      enable_cmp_source = false,
      virtual_text = {
        enabled = vim.g.codeium_enabled,
        manual = false,
        default_filetype_enabled = vim.g.codeium_enabled,
        idle_delay = 150,
        virtual_text_priority = 200,
        map_keys = true,
        key_bindings = {
          -- Tab accepts AI suggestion; keep others non-intrusive
          accept = '<Tab>',
          accept_word = '<C-M-CR>',
          accept_line = '<M-\\>',
          clear = '<C-BS>',
          next = '<M-]>',
          prev = '<M-[>',
        },
      },
    })

    -- Improve Codeium ghost text visibility
    pcall(vim.api.nvim_set_hl, 0, 'CodeiumSuggestion', {
      fg = '#7aa2f7',
      italic = true,
      nocombine = true,
    })
    pcall(vim.api.nvim_set_hl, 0, 'CodeiumVirtualText', {
      fg = '#7aa2f7',
      italic = true,
      nocombine = true,
    })

    -- Toggle function using manual mode
    local function toggle_codeium()
      vim.g.codeium_enabled = not vim.g.codeium_enabled

      -- Clear any existing suggestions
      pcall(codeium.clear)

      if vim.g.codeium_enabled then
        -- Enable: switch to automatic mode
        codeium.setup({
          virtual_text = {
            enabled = true,
            manual = false,
            default_filetype_enabled = true,
          },
        })
        notify.info('Codeium', 'AI autocomplete enabled')
      else
        -- Disable: switch to manual mode (requires explicit trigger)
        codeium.setup({
          virtual_text = {
            enabled = false,
            manual = true,
            default_filetype_enabled = false,
          },
        })
        notify.info('Codeium', 'AI autocomplete disabled')
      end
    end

    -- Expose toggle function globally
    _G.toggle_codeium = toggle_codeium

    -- Add user command
    vim.api.nvim_create_user_command('CodeiumToggle', toggle_codeium, {
      desc = 'Toggle Codeium AI autocomplete',
    })

    -- Add keymap
    vim.keymap.set('n', '<leader>ea', toggle_codeium, {
      desc = 'Toggle AI autocomplete (Codeium)',
      silent = true,
    })
  end,
}
