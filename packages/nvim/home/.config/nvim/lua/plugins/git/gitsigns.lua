return {
  'lewis6991/gitsigns.nvim',
  opts = {
    signs = {
      add = { text = '▎' },
      change = { text = '▎' },
      delete = { text = '' },
      topdelete = { text = '' },
      changedelete = { text = '▎' },
      untracked = { text = '▎' },
    },
    signs_staged = {
      add = { text = '▎' },
      change = { text = '▎' },
      delete = { text = '' },
      topdelete = { text = '' },
      changedelete = { text = '▎' },
    },
    numhl = true,
    word_diff = false,
    current_line_blame_opts = {
      virt_text = true,
      virt_text_pos = 'eol',
      delay = 600,
    },
    current_line_blame_formatter = '<author>, <author_time:%Y-%m-%d> · <summary>',
    on_attach = function(bufnr)
      local gs = package.loaded.gitsigns
      local function map(mode, key, fn, desc) vim.keymap.set(mode, key, fn, { buffer = bufnr, desc = desc }) end

      -- ── Navigation ──────────────────────────────────────────────────────────
      vim.keymap.set('n', '<leader>gj', function()
        if vim.wo.diff then return ']c' end
        vim.schedule(function() gs.next_hunk() end)
        return '<Ignore>'
      end, { buffer = bufnr, expr = true, desc = 'Next hunk' })

      vim.keymap.set('n', '<leader>gk', function()
        if vim.wo.diff then return '[c' end
        vim.schedule(function() gs.prev_hunk() end)
        return '<Ignore>'
      end, { buffer = bufnr, expr = true, desc = 'Previous hunk' })

      -- ── Stage / Reset ────────────────────────────────────────────────────────
      map({ 'n', 'v' }, '<leader>gs', gs.stage_hunk, 'Stage hunk')
      map('n', '<leader>gS', gs.stage_buffer, 'Stage buffer')
      map('n', '<leader>gu', gs.undo_stage_hunk, 'Unstage hunk')
      map({ 'n', 'v' }, '<leader>gr', gs.reset_hunk, 'Reset hunk')
      map('n', '<leader>gR', gs.reset_buffer, 'Reset buffer')

      -- ── Inspect ──────────────────────────────────────────────────────────────
      map('n', '<leader>gp', gs.preview_hunk, 'Preview hunk')
      map('n', '<leader>gi', gs.preview_hunk_inline, 'Preview hunk inline')
      map('n', '<leader>gb', function() gs.blame_line({ full = true }) end, 'Blame line')

      -- ── Diff ─────────────────────────────────────────────────────────────────
      map('n', '<leader>gd', function() gs.diffthis() end, 'Diff vs index')
      map('n', '<leader>gD', function() gs.diffthis('~') end, 'Diff vs HEAD~')

      -- ── Toggles ──────────────────────────────────────────────────────────────
      map('n', '<leader>gB', gs.toggle_current_line_blame, 'Toggle inline blame')
      map('n', '<leader>gW', gs.toggle_word_diff, 'Toggle word diff')
      map('n', '<leader>gX', gs.toggle_deleted, 'Toggle deleted lines')

      -- Review of Claude turns lives in utils/claude-review.lua (<leader>r).
      -- <leader>ri points the gitsigns base at the turn ref so <leader>gr
      -- rejects a hunk against what the agent wrote, not the index.
    end,
  },
  config = function(_, opts) require('gitsigns').setup(opts) end,
}
