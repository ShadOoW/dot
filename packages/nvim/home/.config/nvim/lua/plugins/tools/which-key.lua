return {
  'folke/which-key.nvim',
  -- Load immediately so leader key works without delay
  lazy = false,
  config = function()
    local wk = require('which-key')

    -- Configure which-key
    wk.setup({
      delay = 0,
      timeoutlen = 300,
      icons = {
        mappings = false,
        keys = vim.g.have_nerd_font and {} or {
          Up = '<Up> ',
          Down = '<Down> ',
          Left = '<Left> ',
          Right = '<Right> ',
        },
      },
      spec = {
        {
          '<leader>w',
          group = 'Window',
        },
        {
          '<leader>c',
          group = 'Code',
        },
        { '<leader>cp', desc = 'Peek function definition' },
        { '<leader>cP', desc = 'Peek class definition' },
        {
          '<leader>f',
          group = 'File',
        },
        {
          '<leader>s',
          group = 'Search',
        },
        {
          '<leader>S',
          group = 'Session',
        },
        {
          '<leader>b',
          group = 'Buffers',
        },
        {
          '<leader>e',
          group = 'Editor',
        },
        {
          '<leader>g',
          group = 'Git',
        },
        {
          '<leader>r',
          group = 'Review',
        },
        {
          '<leader>t',
          group = 'Tags & Symbols',
        },
        {
          '<leader>x',
          group = 'Panels',
        },
        {
          '<leader>a',
          group = 'Notes & Journal',
        },
        {
          '<leader>z',
          group = 'File Type',
        },
        {
          '<leader>1',
          group = 'Tab [1-9]',
        },
        {
          '<leader><Right>',
          group = ' Next & Previous Buffer ',
        },
        {
          '<leader><Up>',
          group = ' Next & Previous Tab ',
        },
        {
          '<leader>1',
          desc = 'Tab 1',
          hidden = true,
        },
        {
          '<leader>2',
          desc = 'Tab 2',
          hidden = true,
        },
        {
          '<leader>3',
          desc = 'Tab 3',
          hidden = true,
        },
        {
          '<leader>4',
          desc = 'Tab 4',
          hidden = true,
        },
        {
          '<leader>5',
          desc = 'Tab 5',
          hidden = true,
        },
        {
          '<leader>6',
          desc = 'Tab 6',
          hidden = true,
        },
        {
          '<leader>7',
          desc = 'Tab 7',
          hidden = true,
        },
        {
          '<leader>8',
          desc = 'Tab 8',
          hidden = true,
        },
        {
          '<leader>9',
          desc = 'Tab 9',
          hidden = true,
        },
        {
          '<leader><Down>',
          desc = 'Previous Tab',
          hidden = true,
        },
        {
          '<leader><Left>',
          desc = 'Previous Buffer',
          hidden = true,
        },
        {
          '<leader><Right>',
          desc = 'Next Buffer',
          hidden = true,
        },
        {
          '<leader><Up>',
          desc = 'Next Tab',
          hidden = true,
        },
      },
    })
  end,
}
