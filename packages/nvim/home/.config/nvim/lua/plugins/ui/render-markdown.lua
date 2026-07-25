-- render-markdown.nvim - Beautiful markdown rendering
return {
  'MeanderingProgrammer/render-markdown.nvim',
  dependencies = { 'nvim-treesitter/nvim-treesitter', 'nvim-tree/nvim-web-devicons' },
  ft = { 'markdown' },
  config = function()
    local render_markdown = require('render-markdown')

    render_markdown.setup({
      -- Determines how icons fill the available space:
      --  inline:  underlying text is concealed resulting in a left aligned icon
      --  overlay: result is left padded with spaces to hide any additional text
      sign = {
        -- Turn on / off sign rendering
        enabled = true,
        -- Replaces any existing signs in the sign column, if disabled then we append
        replace = true,
      },
      -- Window options to use that change between rendered and raw view
      win_options = {
        -- See :h 'conceallevel'
        conceallevel = {
          -- Used when not being rendered, gets user default
          default = 0,
          -- Used when being rendered, see :h 'conceallevel'
          rendered = 3,
        },
        -- See :h 'concealcursor'
        concealcursor = {
          -- Used when not being rendered, gets user default
          default = '',
          -- Used when being rendered, see :h 'concealcursor'
          rendered = '',
        },
      },
      -- Mapping from treesitter language to user defined handlers
      -- See 'Custom Handlers' document for more info
      custom_handlers = {},
      -- Define the handler for different heading levels
      heading = {
        -- Turn on / off heading icon & background rendering
        enabled = true,
        -- Turn on / off any sign column related rendering
        sign = true,
        -- Replaces '#+' of 'atx_h._marker'
        -- The number of '#' in the heading determines the 'level'
        -- The 'level' is used to index into the array using a cycle
        -- The result is left padded with spaces to hide any additional text
        icons = { '󰲡 ', '󰲣 ', '󰲥 ', '󰲧 ', '󰲩 ', '󰲫 ' },
        -- Added to the sign column if enabled
        -- The 'level' is used to index into the array using a cycle
        signs = { '󰫎 ' },
        -- Width of the heading background:
        --  block: width of the heading text
        --  full:  full width of the window
        width = 'full',
        -- Amount of padding to add to the left of headings
        left_pad = 0,
        -- Amount of padding to add to the right of headings when width is 'block'
        right_pad = 0,
        -- Minimum width to use for headings when width is 'block'
        min_width = 0,
        -- Determins if a border is added above and below headings
        border = false,
        -- Always use virtual text for headings, ignoring only_visual_range
        above = false,
        -- Always use virtual text for headings, ignoring only_visual_range
        below = false,
      },
      -- Define the handler for paragraphs
      paragraph = {
        -- Turn on / off paragraph rendering
        enabled = true,
        -- Amount of padding to add to the left of paragraphs
        left_pad = 0,
        -- Amount of padding to add to the right of paragraphs
        right_pad = 0,
      },
      -- Define the handler for code blocks
      code = {
        -- Turn on / off code block & inline code rendering
        enabled = true,
        -- Turn on / off any sign column related rendering
        sign = true,
        -- Determines how code blocks & inline code are rendered:
        --  none:     disables all rendering
        --  normal:   adds highlight group to code blocks & inline code
        --  language: adds language icon to sign column and icon + name above code blocks
        --  full:     normal + language
        style = 'full',
        -- Amount of padding to add around the code block
        left_pad = 0,
        right_pad = 0,
        -- Width of the code block background:
        --  block: width of the code block
        --  full:  full width of the window
        width = 'full',
        -- Determins how the top / bottom of code block are rendered:
        --  thick: use the same highlight as the code body
        --  thin:  when lines are empty overlay the above & below icons
        border = 'thin',
        -- Used above code blocks for thin border
        above = '▄',
        -- Used below code blocks for thin border
        below = '▀',
        -- Highlight for code blocks & inline code
        highlight = 'RenderMarkdownCode',
        highlight_inline = 'RenderMarkdownCodeInline',
      },
      -- Define the handler for dash
      dash = {
        -- Turn on / off thematic break rendering
        enabled = true,
        -- Replaces '---'|'***'|'___'
        icon = '─',
        -- Width of the generated line:
        --  <integer>: a hard coded width value
        --  full:      full width of the window
        width = 'full',
        -- Highlight for the whole line generated from the icon
        highlight = 'RenderMarkdownDash',
      },
      -- Define the handler for bullets
      bullet = {
        -- Turn on / off list bullet rendering
        enabled = true,
        -- Replaces '-'|'+'|'*' of 'list_item'
        -- How deeply nested the list is determines the 'level'
        -- The 'level' is used to index into the array using a cycle
        -- If the item is a 'checkbox' a conceal is used to hide the bullet instead
        icons = { '●', '○', '◆', '◇' },
        -- Padding to add to the left of bullet point
        left_pad = 0,
        -- Padding to add to the right of bullet point
        right_pad = 0,
        -- Highlight for the bullet icon
        highlight = 'RenderMarkdownBullet',
      },
      -- Define the handler for checkboxes
      checkbox = {
        -- Turn on / off checkbox state rendering
        enabled = true,
        unchecked = {
          -- Replaces '[ ]' of 'task_list_marker_unchecked'
          icon = '󰄱 ',
          -- Highlight for the unchecked icon
          highlight = 'RenderMarkdownUnchecked',
        },
        checked = {
          -- Replaces '[x]' of 'task_list_marker_checked'
          icon = '󰱒 ',
          -- Highligh for the checked icon
          highlight = 'RenderMarkdownChecked',
        },
        -- Define custom checkbox states, more involved as they are not part of the markdown grammar
        -- As a result this requires neovim >= 0.10.0 since it relies on 'inline' extmarks
        -- Can specify as many additional states as you like following the 'todo' pattern below
        --   The key in this case 'todo' is for convenience and does not represent the text
        --   Instead the key is used for configuration and to uniquely identify the extmark
        custom = {
          todo = {
            raw = '[-]',
            rendered = '󰥔 ',
            highlight = 'RenderMarkdownTodo',
          },
        },
      },
      -- Define the handler for block quotes
      quote = {
        -- Turn on / off block quote & callout rendering
        enabled = true,
        -- Replaces '>' of 'block_quote'
        icon = '▋',
        -- Highlight for the quote icon
        highlight = 'RenderMarkdownQuote',
      },
      -- Define the handler for table pipes
      pipe_table = {
        -- Turn on / off pipe table rendering
        enabled = true,
        -- Determines how the table as a whole is rendered:
        --  none:   disables all rendering
        --  normal: applies the 'cell' style rendering to each row of the table
        --  full:   normal + a top & bottom line that fill out the table when lengths match
        style = 'full',
        -- Determines how individual cells of a table are rendered:
        --  overlay: writes completely over the table, removing conceal behavior and highlights
        --  raw:     replaces only the '|' characters in each row, leaving the cells unmodified
        --  padded:  raw + cells are padded with inline extmarks to make up for any concealed text
        cell = 'padded',
                -- Characters used to replace table border
                -- Correspond to top(3), delimiter(3), bottom(3), vertical, & horizontal
                -- stylua: ignore
                border = {'┌', '┬', '┐', '├', '┼', '┤', '└', '┴', '┘', '│', '─'},
        -- Highlight for table heading, delimiter, and the line above
        head = 'RenderMarkdownTableHead',
        -- Highlight for everything else, main table rows and the line below
        row = 'RenderMarkdownTableRow',
        -- Highlight for inline padding used to add back concealed space
        filler = 'RenderMarkdownTableFill',
      },
      -- Define the handler for callouts
      callout = {
        note = {
          raw = '[!NOTE]',
          rendered = '󰋽 Note',
          highlight = 'RenderMarkdownInfo',
        },
        tip = {
          raw = '[!TIP]',
          rendered = '󰌶 Tip',
          highlight = 'RenderMarkdownSuccess',
        },
        important = {
          raw = '[!IMPORTANT]',
          rendered = '󰅾 Important',
          highlight = 'RenderMarkdownHint',
        },
        warning = {
          raw = '[!WARNING]',
          rendered = '󰀪 Warning',
          highlight = 'RenderMarkdownWarn',
        },
        caution = {
          raw = '[!CAUTION]',
          rendered = '󰳦 Caution',
          highlight = 'RenderMarkdownError',
        },
        -- Obsidian
        abstract = {
          raw = '[!ABSTRACT]',
          rendered = '󰨸 Abstract',
          highlight = 'RenderMarkdownInfo',
        },
        todo = {
          raw = '[!TODO]',
          rendered = '󰗡 Todo',
          highlight = 'RenderMarkdownInfo',
        },
        success = {
          raw = '[!SUCCESS]',
          rendered = '󰄬 Success',
          highlight = 'RenderMarkdownSuccess',
        },
        question = {
          raw = '[!QUESTION]',
          rendered = '󰘥 Question',
          highlight = 'RenderMarkdownWarn',
        },
        failure = {
          raw = '[!FAILURE]',
          rendered = '󰅖 Failure',
          highlight = 'RenderMarkdownError',
        },
        danger = {
          raw = '[!DANGER]',
          rendered = '󱐌 Danger',
          highlight = 'RenderMarkdownError',
        },
        bug = {
          raw = '[!BUG]',
          rendered = '󰨰 Bug',
          highlight = 'RenderMarkdownError',
        },
        example = {
          raw = '[!EXAMPLE]',
          rendered = '󰉹 Example',
          highlight = 'RenderMarkdownHint',
        },
        quote = {
          raw = '[!QUOTE]',
          rendered = '󱆨 Quote',
          highlight = 'RenderMarkdownQuote',
        },
      },
      -- Define the handler for links
      link = {
        -- Turn on / off inline link icon rendering
        enabled = true,
        -- Inlined with 'image' elements
        image = '󰥶 ',
        -- Inlined with 'inline_link' elements
        hyperlink = '󰌹 ',
        -- Applies to the inlined icon
        highlight = 'RenderMarkdownLink',
      },
      -- Define the handler for inline highlighting
      inline_highlight = {
        -- Turn on / off inline highlight rendering
        enabled = true,
      },
      -- Mapping from treesitter language to file extension
      file_types = { 'markdown' },
      -- Vim modes in which a render will be triggered, see :h mode()
      render_modes = { 'n', 'c', 't' },
      -- Set the behavior of anti-conceal, determines when to show the raw markdown content
      -- default: show raw content when cursor is on the line
      -- always: always show raw content on cursor line
      -- never:  never show raw content on cursor line
      anti_conceal = {
        -- This determines when to show the raw markdown instead of the rendered version
        enabled = true,
        -- Set to "cursor" to show raw content when cursor is on the line
        -- Set to "range" to show raw content only when cursor is in the range
        -- Set to "none" to never show raw content
        above = 1,
        below = 1,
      },
      -- LaTeX support configuration
      latex = {
        -- Turn on / off LaTeX rendering
        enabled = true,
        -- Executable used to convert latex formula to rendered unicode
        converter = 'latex2text',
        -- Highlight for LaTeX blocks
        highlight = 'RenderMarkdownMath',
        -- Amount of empty lines above LaTeX blocks
        top_pad = 0,
        -- Amount of empty lines below LaTeX blocks
        bottom_pad = 0,
      },
      -- HTML support configuration
      html = {
        -- Turn on / off HTML rendering
        enabled = true,
      },
    })

    -- Keymaps for toggling render
    vim.keymap.set('n', '<leader>mr', '<cmd>RenderMarkdown toggle<cr>', {
      desc = 'Toggle markdown render',
    })
    vim.keymap.set('n', '<leader>mR', '<cmd>RenderMarkdown enable<cr>', {
      desc = 'Enable markdown render',
    })
    vim.keymap.set('n', '<leader>md', '<cmd>RenderMarkdown disable<cr>', {
      desc = 'Disable markdown render',
    })
  end,
}
