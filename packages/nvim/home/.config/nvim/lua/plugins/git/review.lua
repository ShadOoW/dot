-- review.nvim: typed review annotations (Issue/Suggestion/Note/Praise) on top
-- of codediff, exported as AI-ready markdown. Close a review with `q` and the
-- export lands in the clipboard — <leader>rs pipes it into the repo's running
-- Claude Code window.
return {
  'georgeguimaraes/review.nvim',
  version = 'v*',
  cmd = 'Review',
  dependencies = {
    'esmuellert/codediff.nvim',
    'MunifTanjim/nui.nvim',
  },
  opts = {},
  keys = {
    { '<leader>rr', '<cmd>Review<cr>', desc = 'Review & annotate working tree' },
    { '<leader>rR', '<cmd>Review commits<cr>', desc = 'Review & annotate commits' },
  },
}
