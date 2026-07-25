-- Mini UI modules
return {
  'echasnovski/mini.nvim',
  version = false,
  config = function()
    -- Color manipulation utilities and unique colorscheme
    require('mini.colors').setup({})

    -- Show indent scope with visible guides
    require('mini.indentscope').setup({
      symbol = '│',
      options = {
        try_as_border = true,
      },
      draw = {
        delay = 100,
        animation = require('mini.indentscope').gen_animation.none(),
      },
      -- Disable for special filetypes
      filetype_exclude = {
        'lazy',
        'mason',
        'trouble',
        'neo-tree',
        'NvimTree',
        'TelescopePrompt',
        'help',
        'startify',
        'gitcommit',
        'packer',
        'lspinfo',
        'lspsagaoutline',
        'checkhealth',
        'man',
        'git',
        'prompt',
        'floaterm',
        '',
      },
    })

    -- Highlight patterns like colors, todos, URLs, etc.
    require('mini.hipatterns').setup({
      highlighters = {
        -- Highlight standalone 'FIXME', 'HACK', 'TODO', 'NOTE'
        fixme = {
          pattern = '%f[%w]()FIXME()%f[%W]',
          group = 'MiniHipatternsFixme',
        },
        hack = {
          pattern = '%f[%w]()HACK()%f[%W]',
          group = 'MiniHipatternsHack',
        },
        todo = {
          pattern = '%f[%w]()TODO()%f[%W]',
          group = 'MiniHipatternsTodo',
        },
        note = {
          pattern = '%f[%w]()NOTE()%f[%W]',
          group = 'MiniHipatternsNote',
        },

        -- Highlight hex color strings (`#rrggbb`) using that color
        hex_color = require('mini.hipatterns').gen_highlighter.hex_color(),
      },
    })
  end,
}
