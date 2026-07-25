-- Enhanced bracket/parentheses matching
return {
  {
    'andymass/vim-matchup',
    event = { 'BufReadPost', 'BufNewFile' },
    config = function()
      -- Enhanced matching for brackets, parentheses, and more
      vim.g.matchup_matchparen_offscreen = {
        method = 'popup',
      }
      vim.g.matchup_matchparen_deferred = 1
      vim.g.matchup_matchparen_hi_surround_always = 1

      -- Disable default matchparen since we're using matchup
      vim.g.loaded_matchparen = 1

      -- Prevent matchdelete errors by using safer cleanup
      -- This helps avoid E119 errors when buffers are deleted quickly
      vim.g.matchup_matchparen_nomode = 'i' -- Disable in insert mode to reduce conflicts
      vim.g.matchup_matchparen_timeout = 100 -- Shorter timeout to reduce race conditions

      -- Custom highlight for matching pairs
      vim.api.nvim_set_hl(0, 'MatchParen', {
        bg = '#414868',
        fg = '#c0caf5',
        bold = true,
      })

      -- Highlight for off-screen matches
      vim.api.nvim_set_hl(0, 'MatchParenCur', {
        bg = '#414868',
        fg = '#7aa2f7',
        bold = true,
      })

      -- Configure which pairs to match
      vim.g.matchup_matchparen_enabled = 1
      vim.g.matchup_motion_enabled = 1
      vim.g.matchup_text_obj_enabled = 1

      -- Cleanup matches when buffer is deleted to prevent errors
      vim.api.nvim_create_autocmd('BufDelete', {
        callback = function()
          -- Safely clear matches for deleted buffer
          pcall(vim.fn.clearmatches)
        end,
      })
    end,
  },
}
