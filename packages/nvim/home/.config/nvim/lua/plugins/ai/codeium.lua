-- Codeium AI completion - FREE with generous limits
return {
  'Exafunction/codeium.nvim',
  dependencies = { 'nvim-lua/plenary.nvim', 'hrsh7th/nvim-cmp' },
  event = 'InsertEnter',
  build = ':Codeium Auth',
  config = function()
    local codeium = require('codeium')
    local notify = require('utils.notify')

    -- Default: off, i.e. suggestions only when asked for with <M-\>.  Unprompted
    -- ghost text answers a question you have not finished asking yet, which is
    -- the opposite of what you want while learning a language.  `<leader>ea`
    -- flips it to automatic.  Explicit nil check so `false` is respected.
    if vim.g.codeium_enabled == nil then vim.g.codeium_enabled = false end

    codeium.setup({
      enable_cmp_source = false,
      virtual_text = {
        enabled = true,
        -- manual = nothing is requested until a key asks for it
        manual = not vim.g.codeium_enabled,
        default_filetype_enabled = true,
        idle_delay = 150,
        virtual_text_priority = 200,
        map_keys = true,
        key_bindings = {
          -- Tab accepts, and is only ever live once a suggestion is on screen
          accept = '<Tab>',
          accept_word = '<C-M-CR>',
          accept_line = '<M-CR>',
          clear = '<C-BS>',
          next = '<M-]>',
          prev = '<M-[>',
        },
      },
    })

    -- Ask for a suggestion here, now.  Works in both modes: in manual mode it
    -- fetches, in automatic mode it cycles to the next candidate.
    vim.keymap.set(
      'i',
      '<M-\\>',
      function() require('codeium.virtual_text').cycle_or_complete() end,
      { desc = 'Request AI suggestion (Codeium)', silent = true }
    )

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

      -- Both states keep the plugin live; only who initiates changes.  Manual
      -- mode still answers <M-\>, so turning AI "off" costs no capability.
      codeium.setup({
        virtual_text = {
          enabled = true,
          manual = not vim.g.codeium_enabled,
          default_filetype_enabled = true,
        },
      })

      if vim.g.codeium_enabled then
        notify.info('Codeium', 'AI suggests as you type')
      else
        notify.info('Codeium', 'AI on request only (<M-\\>)')
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
