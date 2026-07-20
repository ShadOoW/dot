-- codediff.nvim: VSCode-quality diff surface (char-level two-tier highlights,
-- moved-code detection, explorer with per-hunk stage/discard). Primary review
-- surface; diffview.nvim stays for history browsing only.
return {
  'esmuellert/codediff.nvim',
  cmd = 'CodeDiff',
  opts = {},
  keys = {
    { '<leader>rl', '<cmd>CodeDiff HEAD~1 HEAD<cr>', desc = 'Review last commit' },
  },
}
