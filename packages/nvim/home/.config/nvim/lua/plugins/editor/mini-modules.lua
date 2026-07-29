-- Mini editing modules
return {
  'echasnovski/mini.nvim',
  version = false,
  config = function()
    -- Split or join arguments, lists, tables, etc.
    require('mini.splitjoin').setup({})

    -- Navigate by brackets and other items
    require('mini.bracketed').setup({})

    -- Add/delete/replace surroundings (enhanced version)
    -- Prefixed with `g` so bare `s` belongs to flash.nvim: a jump you make
    -- dozens of times an hour earns the single keystroke, surrounding a word
    -- does not.  Same letters as before, one key earlier.
    require('mini.surround').setup({
      -- Add custom surroundings here if needed
      mappings = {
        add = 'gsa', -- Add surrounding in Normal and Visual modes
        delete = 'gsd', -- Delete surrounding
        find = 'gsf', -- Find surrounding (to the right)
        find_left = 'gsF', -- Find surrounding (to the left)
        highlight = 'gsh', -- Highlight surrounding
        replace = 'gsc', -- Replace surrounding
        update_n_lines = 'gsn', -- Update `n_lines`
      },
    })

    -- Enhanced comment functionality
    require('mini.comment').setup({
      -- Options which control module behavior
      options = {
        -- Function to compute custom 'commentstring' (optional)
        custom_commentstring = nil,

        -- Whether to ignore blank lines when adding comment
        ignore_blank_line = false,

        -- Whether to recognize as comment only lines without indent
        start_of_line = false,

        -- Whether to ensure single space pad for comment parts
        pad_comment_parts = true,
      },

      -- Module mappings. Use `''` (empty string) to disable one.
      mappings = {
        -- Toggle comment (e.g. <leader>cip - toggle comment paragraph)
        comment = '<leader>c',

        -- Toggle comment on current line
        comment_line = '<leader>cc',

        -- Toggle comment on visual selection
        comment_visual = '<leader>c',

        -- Define 'comment' textobject (e.g. d<leader>c - delete whole comment block)
        textobject = '<leader>c',
      },

      -- Hook functions to be executed at certain stage of commenting
      hooks = {
        -- Before successful commenting. Does nothing by default.
        pre = function() end,
        -- After successful commenting. Does nothing by default.
        post = function() end,
      },
    })

    -- Enhanced text objects and motions
    require('mini.ai').setup({
      -- Search method can be 'cover', 'cover_or_next', 'cover_or_prev', 'next', 'prev'
      search_method = 'cover_or_next',
      -- Custom text objects can be added here
      custom_textobjects = {
        -- Add your custom text objects here if needed
      },
    })

    -- Trailing whitespace management with automatic trimming
    require('mini.trailspace').setup({
      -- Highlight only in specific filetypes (nil means all)
      only_in_normal_buffers = true,
    })

    -- Movement & Navigation
    -- Jump to any visible location with two-character input
    require('mini.jump2d').setup({
      mappings = {
        start_jumping = '<M-f>',
      },
      -- View configuration
      view = {
        -- Dim the source of jump spots
        dim = true,
        -- Number of steps ahead to be shown
        n_steps_ahead = 1,
      },
      -- Whether to disable showing non-first jump spot
      silent = false,
    })

    -- Track and visit recent files and buffers
    require('mini.visits').setup({})

    -- Utilities & Extras
    -- Remove buffers without losing window layout
    require('mini.bufremove').setup({})
  end,
}
