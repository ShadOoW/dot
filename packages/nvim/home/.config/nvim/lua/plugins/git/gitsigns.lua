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

      -- ── Diff review mode ─────────────────────────────────────────────────────
      -- Full-width line coverage strategy: hide sign column + line numbers so
      -- linehl (GitSignsAddLn etc.) covers the entire window width unobstructed.
      -- numhl_group bg is unreliable in Neovim — hiding the columns is the only
      -- definitive fix. Matches how delta/lazygit render diffs (no gutter clutter).
      local _diff_mode = false
      local _prev = {} -- saved window settings

      local function review_on()
        gs.toggle_linehl(true)
        gs.toggle_word_diff(true)
        gs.toggle_deleted(true)
        gs.change_base('HEAD', true)
        -- Save and hide gutter columns for full-width linehl coverage
        _prev.number = vim.wo.number
        _prev.relativenumber = vim.wo.relativenumber
        _prev.signcolumn = vim.wo.signcolumn
        vim.wo.number = false
        vim.wo.relativenumber = false
        vim.wo.signcolumn = 'no'
        -- Stronger word-diff contrast for review
        vim.api.nvim_set_hl(0, 'GitSignsAddInline', { bg = '#2d6b40', bold = true })
        vim.api.nvim_set_hl(0, 'GitSignsChangeInline', { bg = '#2d6b40', bold = true })
        vim.api.nvim_set_hl(0, 'GitSignsDeleteInline', { bg = '#7a2020', bold = true })
        vim.notify('  Diff review mode ON', vim.log.levels.INFO, { title = 'Git' })
      end

      local function review_off()
        gs.toggle_linehl(false)
        gs.toggle_word_diff(false)
        gs.toggle_deleted(false)
        gs.reset_base(true)
        -- Restore gutter columns
        vim.wo.number = _prev.number ~= nil and _prev.number or true
        vim.wo.relativenumber = _prev.relativenumber ~= nil and _prev.relativenumber or false
        vim.wo.signcolumn = _prev.signcolumn ~= nil and _prev.signcolumn or 'yes:1'
        -- Restore normal word-diff colors
        vim.api.nvim_set_hl(0, 'GitSignsAddInline', { bg = '#1f4a2e', bold = true })
        vim.api.nvim_set_hl(0, 'GitSignsChangeInline', { bg = '#1a3060', bold = true })
        vim.api.nvim_set_hl(0, 'GitSignsDeleteInline', { bg = '#4a1a1a', bold = true })
        vim.notify('  Diff review mode OFF', vim.log.levels.INFO, { title = 'Git' })
      end

      map('n', '<leader>rm', function()
        _diff_mode = not _diff_mode
        if _diff_mode then
          review_on()
        else
          review_off()
        end
      end, 'Toggle diff review mode')

      -- Auto-disable linehl/word_diff while typing so they don't distract
      local aug = vim.api.nvim_create_augroup('gitsigns_review_mode_' .. bufnr, { clear = true })
      vim.api.nvim_create_autocmd('InsertEnter', {
        group = aug,
        buffer = bufnr,
        callback = function()
          if _diff_mode then
            gs.toggle_linehl(false)
            gs.toggle_word_diff(false)
          end
        end,
      })
      vim.api.nvim_create_autocmd('InsertLeave', {
        group = aug,
        buffer = bufnr,
        callback = function()
          if _diff_mode then
            gs.toggle_linehl(true)
            gs.toggle_word_diff(true)
          end
        end,
      })
    end,
  },
  config = function(_, opts) require('gitsigns').setup(opts) end,
}
