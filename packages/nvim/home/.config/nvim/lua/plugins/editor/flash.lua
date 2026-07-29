-- Enhanced jump navigation (replaces mini.jump)
return {
  'folke/flash.nvim',
  event = 'VeryLazy',
  opts = {
    -- Labels to use for the flash search
    labels = 'asdfghjklqwertyuiopzxcvbnm',
    search = {
      -- search/jump in all windows
      multi_window = true,
      -- search direction
      forward = true,
      -- when `false`, find only matches in the given direction
      wrap = true,
      ---@type Flash.Pattern.Mode
      -- Each mode will take care of highlighting the matches, jumping, labeling.
      mode = 'exact',
      -- behave like `incsearch`
      incremental = false,
      -- Excluded filetypes and buftypes from flash
      exclude = {
        'notify',
        'cmp_menu',
        'noice',
        'flash_prompt',
        'fzf',
        function(win) return vim.bo[vim.api.nvim_win_get_buf(win)].filetype == 'neo-tree' end,
        function(win) return vim.bo[vim.api.nvim_win_get_buf(win)].filetype == 'fzf' end,
      },
      -- Optional trigger character that needs to be typed before
      -- a jump label can be used. It's NOT recommended to set this,
      -- unless you know what you're doing
      trigger = '',
      -- max pattern length. If the pattern length is equal to this
      -- labels will no longer be skipped. When it exceeds this length
      -- it will either end in a jump or terminate the search
      max_length = false, ---@type number|false
    },
    jump = {
      -- save location in the jumplist
      jumplist = true,
      -- jump position
      pos = 'start', ---@type "start" | "end" | "range"
      -- Landing on a label ends the flash prompt, so `n`/`N` are the only way
      -- to keep moving through the rest of the matches.  Writing the pattern to
      -- the search register and history is what makes them work — otherwise you
      -- have to start the search over to reach the second occurrence.
      history = true,
      register = true,
      -- Clear the highlight on landing even though the register is set: leaving
      -- every match lit is the sort of standing decoration we removed
      -- everywhere else.  `n` turns it back on for as long as you are using it.
      nohlsearch = true,
      -- automatically jump when there is only one match
      autojump = false,
      -- You can force inclusive/exclusive jumps by setting the
      -- `inclusive` option. By default it will be automatically
      -- set based on the mode.
      inclusive = nil, ---@type boolean?
      -- jump position offset. Not used for range jumps.
      -- 0: default
      -- 1: when pos == "end" and pos < current position
      offset = nil, ---@type number
    },
    label = {
      -- allow uppercase labels
      uppercase = true,
      -- add any labels with the correct case here, that you want to exclude
      exclude = '',
      -- add a label for the first match in the current window.
      -- you can always jump to the first match with `<CR>`
      current = true,
      -- show the label after the match
      after = true, ---@type boolean|number[]
      -- show the label before the match
      before = false, ---@type boolean|number[]
      -- position of the label extmark
      style = 'overlay', ---@type "eol" | "overlay" | "right_align" | "inline"
      -- flash tries to re-use labels that were already assigned to a position,
      -- when typing more characters. By default only lower-case labels are re-used.
      reuse = 'lowercase', ---@type "lowercase" | "all" | "none"
      -- for the current window, label targets closer to the cursor first
      distance = true,
      -- minimum pattern length to show labels
      -- Ignored for custom labelers.
      min_pattern_length = 0,
      -- Enable this to use rainbow colors to highlight labels
      -- Can be useful for visualizing Treesitter ranges.
      rainbow = {
        enabled = false,
        -- number between 1 and 9
        shade = 5,
      },
    },
    highlight = {
      -- Disable backdrop to prevent graying out text
      backdrop = false,
      -- Highlight the search matches
      matches = true,
      -- extmark priority
      priority = 5000,
      groups = {
        match = 'FlashMatch',
        current = 'FlashCurrent',
        backdrop = 'FlashBackdrop',
        label = 'FlashLabel',
      },
    },
    -- action to perform when picking a label.
    -- defaults to the jumping logic depending on the mode.
    ---@type fun(match:Flash.Match, state:Flash.State)|nil
    action = nil,
    -- initial pattern to use when opening flash
    pattern = '',
    -- When `true`, flash will try to continue the last search
    continue = false,
    -- Set config for ftFT motions
    config = function(opts)
      -- autohide flash when in operator-pending mode
      vim.api.nvim_create_autocmd('User', {
        pattern = 'FlashEnter',
        callback = function() vim.opt.cmdheight = 1 end,
      })
      vim.api.nvim_create_autocmd('User', {
        pattern = 'FlashLeave',
        callback = function()
          -- Restore cmdheight
          vim.opt.cmdheight = 0
        end,
      })
    end,
    -- You can override the default options for a specific mode.
    -- Use it with `require("flash").jump({mode = "forward"})`
    ---@type table<string, Flash.Config>
    modes = {
      -- options used when flash is activated through
      -- a regular search with `/` or `?`
      search = {
        -- when `true`, flash will be activated during regular search by default.
        -- Disabled: labels intercept keystrokes during / and ? search, preventing typing full patterns.
        -- Use g/ for Flash search with labels.
        enabled = false,
        highlight = {
          backdrop = false,
        },
        jump = {
          history = true,
          register = true,
          nohlsearch = true,
        },
        search = {
          -- `forward` will be automatically set to the search direction
          -- `mode` is always set to `search`
          -- `incremental` is set to `true` when `incsearch` is enabled
        },
      },
      -- options used when flash is activated through
      -- `f`, `F`, `t`, `T`, `;` and `,` motions
      char = {
        enabled = true,
        -- dynamic configuration for ftFT motions
        config = function(opts)
          -- autohide flash when in operator-pending mode
          opts.autohide = opts.autohide or (vim.fn.mode(true):find('no') and vim.v.operator == 'y')

          -- disable jump labels when not enabled, when using a count,
          -- or when recording/executing registers
          opts.jump_labels = opts.jump_labels
            and vim.v.count == 0
            and vim.fn.reg_executing() == ''
            and vim.fn.reg_recording() == ''

          -- Show jump labels only in operator-pending mode
          -- opts.jump_labels = vim.v.count == 0 and vim.fn.mode(true):find("o")
        end,
        -- hide after jump when not using jump labels
        autohide = false,
        -- show jump labels
        jump_labels = false,
        -- set to `false` to use the current line only
        multi_line = true,
        -- When using jump labels, don't use these keys
        -- This allows using those keys directly after the motion
        label = {
          exclude = 'hjkliardc',
        },
        -- by default all keymaps are enabled, but you can disable some of them,
        -- by removing them from the list.
        -- If you rather use another key, you can map them
        -- to something else, e.g., { [";"] = "L", [","] = H }
        keys = { 'f', 'F', 't', 'T', ';', ',' },
        ---@type number
        char_actions = function(motion)
          return {
            [';'] = 'next', -- set to `right` to always go right
            [','] = 'prev', -- set to `left` to always go left
            -- clever-f style
            [motion:lower()] = 'next',
            [motion:upper()] = 'prev',
            -- jump2d style: same case goes next, opposite case goes prev
            -- [motion] = "next",
            -- [motion:match("%l") and motion:upper() or motion:lower()] = "prev",
          }
        end,
        search = {
          wrap = false,
        },
        highlight = {
          backdrop = false, -- Disable backdrop for F/T motions to prevent graying
        },
        jump = {
          register = false,
        },
      },
      -- options used for treesitter selections
      -- `require("flash").treesitter()`
      treesitter = {
        labels = 'abcdefghijklmnopqrstuvwxyz',
        jump = {
          pos = 'range',
        },
        search = {
          incremental = false,
        },
        label = {
          before = true,
          after = true,
          style = 'inline',
        },
        highlight = {
          backdrop = false,
          matches = false,
        },
      },
      treesitter_search = {
        jump = {
          pos = 'range',
        },
        search = {
          multi_window = true,
          wrap = true,
          incremental = false,
        },
        remote_op = {
          restore = true,
        },
        label = {
          before = true,
          after = true,
          style = 'inline',
        },
      },
      -- options used for remote flash
      remote = {
        remote_op = {
          restore = true,
          motion = true,
        },
      },
    },
    -- options for the floating window that shows the prompt,
    -- for regular jumps
    prompt = {
      enabled = true,
      prefix = { { '', 'FlashPromptIcon' } },
      win_config = {
        relative = 'editor',
        width = 1, -- when <=1 it's a percentage of the editor width
        height = 1,
        row = -1, -- when negative it's an offset from the bottom
        col = 0, -- when negative it's an offset from the right
        zindex = 1000,
      },
    },
    -- options for remote operator pending mode
    remote_op = {
      -- restore window views and cursor position
      -- after doing a remote operation
      restore = false,
      -- For `jump.pos = "range"`, this setting is ignored.
      -- `true`: always enter a new motion when doing a remote operation
      -- `false`: use the window's cursor position and jump target
      -- `nil`: act as `true` for remote windows, `false` for the current window
      motion = false,
    },
  },
  keys = {
    -- `s` and `S` sit next to each other for the two things you do most: go
    -- somewhere you can see, or select the block you are standing in.  Bare `s`
    -- was vanilla's `cl`; mini.surround moved to the `gs` prefix to free it.
    {
      's',
      mode = { 'n', 'x', 'o' },
      function() require('flash').jump() end,
      desc = 'Flash jump to a visible target',
    },
    {
      'S',
      mode = { 'n', 'o', 'x' },
      function() require('flash').treesitter() end,
      desc = 'Flash select surrounding block',
    },
    {
      'r',
      mode = 'o',
      function() require('flash').remote() end,
      desc = 'Remote Flash',
    },
    {
      'R',
      mode = { 'o', 'x' },
      function() require('flash').treesitter_search() end,
      desc = 'Treesitter Search',
    },
    {
      '<c-s>',
      mode = { 'c' },
      function() require('flash').toggle() end,
      desc = 'Toggle Flash Search',
    },
  },
  config = function(_, opts)
    require('flash').setup(opts)

    -- Custom Tokyo Night highlights for Flash to improve visibility
    vim.api.nvim_set_hl(0, 'FlashMatch', {
      bg = '#3d59a1', -- Tokyo night blue selection
      fg = '#c0caf5', -- Tokyo night foreground
      bold = true,
    })

    vim.api.nvim_set_hl(0, 'FlashLabel', {
      bg = '#f7768e', -- Tokyo night red
      fg = '#1a1b26', -- Tokyo night background
      bold = true,
    })

    vim.api.nvim_set_hl(0, 'FlashCurrent', {
      bg = '#9ece6a', -- Tokyo night green
      fg = '#1a1b26', -- Tokyo night background
      bold = true,
    })

    -- Very subtle backdrop - almost invisible to avoid graying out text
    vim.api.nvim_set_hl(0, 'FlashBackdrop', {
      fg = '#565f89', -- Very subtle dimming
    })
  end,
}
