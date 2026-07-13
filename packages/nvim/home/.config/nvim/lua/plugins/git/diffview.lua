return {
  'sindrets/diffview.nvim',
  cmd = { 'DiffviewOpen', 'DiffviewClose', 'DiffviewFileHistory' },
  config = function()
    local diffview = require('diffview')
    local diffview_config = require('diffview.config')

    -- Lock DiffviewFiles panel against buffer switching (filetype-based, always fires)
    vim.api.nvim_create_autocmd('FileType', {
      pattern = { 'DiffviewFiles', 'DiffviewFileHistory' },
      callback = function(args)
        local opts = { buffer = args.buf, silent = true }
        vim.keymap.set('n', '<leader><Left>', '<Nop>', opts)
        vim.keymap.set('n', '<leader><Right>', '<Nop>', opts)
        vim.keymap.set('n', '<C-^>', '<Nop>', opts)
        vim.keymap.set('n', '<leader>bc', '<Nop>', opts)
        vim.keymap.set('n', '<leader>ba', '<Nop>', opts)
      end,
    })

    diffview.setup({
      diff_binaries = false,
      enhanced_diff_hl = false,
      git_cmd = { 'git' },
      use_icons = true,
      hooks = {
        diff_buf_win_enter = function(bufnr, winid, ctx)
          -- Prevent buffer navigation in all diff windows (both sides)
          local opts = { buffer = bufnr, silent = true }
          vim.keymap.set('n', '<leader><Left>', '<Nop>', opts)
          vim.keymap.set('n', '<leader><Right>', '<Nop>', opts)
          vim.keymap.set('n', '<C-^>', '<Nop>', opts) -- alternate buffer
          vim.keymap.set('n', '<leader>bc', '<Nop>', opts) -- close buffer
          vim.keymap.set('n', '<leader>ba', '<Nop>', opts) -- close others

          -- Left side (old version): read-only, non-modifiable
          local sym = ctx.symbol
          if sym == 'a' or sym == 'A' then
            vim.bo[bufnr].readonly = true
            vim.bo[bufnr].modifiable = false
          end

          -- Right side (new version): explicitly keep modifiable
          if sym == 'b' or sym == 'B' then
            vim.bo[bufnr].readonly = false
            vim.bo[bufnr].modifiable = true
          end
        end,
      },
      icons = {
        folder_closed = '󰉋',
        folder_open = '󰉖',
        added = '󰄮',
        modified = '󰷾',
        deleted = '󰍵',
        untracked = '󰛩',
        renamed = '󰁕',
        unmerged = '󰡙',
        type_changed = '󰉖',
        unknown = '󰀊',
      },
      signs = {
        fold_closed = '󰅂',
        fold_open = '󰅀',
        added = '󰄮',
        modified = '󰷾',
        deleted = '󰍵',
      },
      mappings = {
        view = {
          ['q'] = diffview_config.actions.close,
        },
        file_panel = {
          ['q'] = diffview_config.actions.close,
        },
        file_history_panel = {
          ['q'] = diffview_config.actions.close,
        },
      },
    })
  end,
  -- History browsing only — working-tree/commit review moved to codediff.nvim
  keys = {
    { '<leader>rh', '<cmd>DiffviewFileHistory %<cr>', desc = 'Review file history' },
    { '<leader>rf', '<cmd>DiffviewFileHistory<cr>', desc = 'Review repo history' },
  },
}
