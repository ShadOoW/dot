-- Enhanced seamless navigation between tmux panes and vim splits
return {
  'christoomey/vim-tmux-navigator',
  lazy = false, -- We want this plugin to load immediately
  config = function()
    -- Disable default mappings to customize them
    vim.g.tmux_navigator_no_mappings = 1

    -- Better tmux focus detection
    vim.g.tmux_navigator_preserve_zoom = 1
    vim.g.tmux_navigator_disable_when_zoomed = 1

    -- Custom key mappings with descriptions
    local keymap = vim.keymap.set
    local opts = {
      remap = false,
      silent = true,
    }

    -- Navigation keymaps
    keymap(
      'n',
      '<C-h>',
      '<cmd>TmuxNavigateLeft<cr>',
      vim.tbl_extend('force', opts, {
        desc = 'Navigate left (tmux/vim)',
      })
    )
    keymap(
      'n',
      '<C-j>',
      '<cmd>TmuxNavigateDown<cr>',
      vim.tbl_extend('force', opts, {
        desc = 'Navigate down (tmux/vim)',
      })
    )
    keymap(
      'n',
      '<C-k>',
      '<cmd>TmuxNavigateUp<cr>',
      vim.tbl_extend('force', opts, {
        desc = 'Navigate up (tmux/vim)',
      })
    )
    keymap(
      'n',
      '<C-l>',
      '<cmd>TmuxNavigateRight<cr>',
      vim.tbl_extend('force', opts, {
        desc = 'Navigate right (tmux/vim)',
      })
    )
    keymap(
      'n',
      '<C-\\>',
      '<cmd>TmuxNavigatePrevious<cr>',
      vim.tbl_extend('force', opts, {
        desc = 'Navigate to previous (tmux/vim)',
      })
    )

    -- Tab key navigation for seamless tmux/vim pane cycling
    -- Custom function to cycle through panes in a consistent direction
    local function navigate_next_pane()
      -- Try to navigate right first, then down, then wrap around
      local current_win = vim.api.nvim_get_current_win()
      vim.cmd('TmuxNavigateRight')
      -- If we didn't move right, try down
      if vim.api.nvim_get_current_win() == current_win then
        vim.cmd('TmuxNavigateDown')
        -- If we didn't move down either, go to the first pane (left-top)
        if vim.api.nvim_get_current_win() == current_win then
          vim.cmd('TmuxNavigateLeft')
          if vim.api.nvim_get_current_win() == current_win then vim.cmd('TmuxNavigateUp') end
        end
      end
    end

    keymap(
      'n',
      '<Tab>',
      navigate_next_pane,
      vim.tbl_extend('force', opts, {
        desc = 'Navigate to next pane (tmux/vim)',
      })
    )

    -- Shift+Tab key navigation for reverse cycling through panes
    local function navigate_previous_pane()
      -- Try to navigate left first, then up, then wrap around
      local current_win = vim.api.nvim_get_current_win()
      vim.cmd('TmuxNavigateLeft')
      -- If we didn't move left, try up
      if vim.api.nvim_get_current_win() == current_win then
        vim.cmd('TmuxNavigateUp')
        -- If we didn't move up either, go to the last pane (right-bottom)
        if vim.api.nvim_get_current_win() == current_win then
          vim.cmd('TmuxNavigateRight')
          if vim.api.nvim_get_current_win() == current_win then vim.cmd('TmuxNavigateDown') end
        end
      end
    end

    keymap(
      'n',
      '<S-Tab>',
      navigate_previous_pane,
      vim.tbl_extend('force', opts, {
        desc = 'Navigate to previous pane (tmux/vim)',
      })
    )

    -- Additional tmux integration features
    if vim.env.TMUX then
      -- Refresh tmux status on focus regain only (BufEnter fired this far too often)
      vim.api.nvim_create_autocmd('FocusGained', {
        group = vim.api.nvim_create_augroup('tmux-focus', {
          clear = true,
        }),
        callback = function()
          pcall(function() vim.system({ 'tmux', 'refresh-client', '-S' }) end)
        end,
      })
    end

    -- Better integration with vim splits
    -- Auto-resize splits when terminal is resized
    vim.api.nvim_create_autocmd('VimResized', {
      group = vim.api.nvim_create_augroup('tmux-resize', {
        clear = true,
      }),
      callback = function() vim.cmd('wincmd =') end,
    })

    -- Clear search highlight when navigating
    vim.api.nvim_create_autocmd('User', {
      pattern = 'TmuxNavigate*',
      group = vim.api.nvim_create_augroup('tmux-clear-search', {
        clear = true,
      }),
      callback = function() vim.cmd('nohlsearch') end,
    })
  end,
}
