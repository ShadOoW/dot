-- File operations from within the buffer (Genghis)
-- Keymaps: fs=from-selection fx=chmod fy=rel-path fY=abs-path
return {
  'chrisgrieser/nvim-genghis',
  event = 'VeryLazy',
  dependencies = { 'stevearc/dressing.nvim' },
  config = function()
    require('genghis').setup({
      backdrop = {
        enabled = true,
        blend = 50,
      },
      notifyOnEmptyTrash = false,
    })

    vim.keymap.set('v', '<leader>fs', function() require('genghis').moveSelectionToNewFile() end, {
      desc = 'New from selection',
    })

    vim.keymap.set('n', '<leader>fx', '<cmd>Genghis chmodx<CR>', {
      desc = 'chmod +x',
    })

    -- Copy
    vim.keymap.set('n', '<leader>fY', '<cmd>Genghis copyFilepath<CR>', {
      desc = 'Copy absolute path',
    })
    vim.keymap.set('n', '<leader>fy', function()
      local filepath = vim.api.nvim_buf_get_name(0)
      if filepath == '' then return end
      local rel_path
      -- diffview:///abs/path/.git/<hash>/relative/path
      local diffview_inner = filepath:match('^diffview://(.+)$')
      if diffview_inner then
        rel_path = diffview_inner:match('/.git/[^/]+/(.+)$')
        if not rel_path then
          vim.notify('Could not parse diffview path', vim.log.levels.WARN, { title = 'Copy' })
          return
        end
      else
        local git_dir = vim.fn.finddir('.git', vim.fn.fnamemodify(filepath, ':h') .. ';')
        local root = git_dir ~= '' and vim.fn.fnamemodify(git_dir, ':h') or nil
        if root and root ~= '' then
          rel_path = vim.fn.fnamemodify(filepath, ':p'):sub(#root + 2)
        else
          rel_path = vim.fn.fnamemodify(filepath, ':.')
        end
      end
      vim.fn.setreg('+', rel_path)
      vim.notify(rel_path, vim.log.levels.INFO, { title = 'Copied' })
    end, { desc = 'Copy relative path' })
  end,
}
