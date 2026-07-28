-- Treesitter textobjects
-- The 'main' rewrite has no module system, so every mapping is registered
-- explicitly.  It also dropped lsp_interop entirely; peek-definition is
-- reimplemented in utils/ts_peek.lua.
local select_keymaps = {
  ['af'] = '@function.outer',
  ['if'] = '@function.inner',
  ['ac'] = '@class.outer',
  ['ic'] = '@class.inner',
  ['aa'] = '@parameter.outer',
  ['ia'] = '@parameter.inner',
  ['ai'] = '@conditional.outer',
  ['ii'] = '@conditional.inner',
  ['al'] = '@loop.outer',
  ['il'] = '@loop.inner',
  ['ab'] = '@block.outer',
  ['ib'] = '@block.inner',
  ['as'] = '@statement.outer',
  ['is'] = '@statement.inner',
  ['ad'] = '@comment.outer',
  ['id'] = '@comment.inner',
  ['am'] = '@call.outer',
  ['im'] = '@call.inner',
}

local move_keymaps = {
  goto_next_start = {
    [']f'] = '@function.outer',
    [']c'] = '@class.outer',
    [']a'] = '@parameter.inner',
    [']i'] = '@conditional.outer',
    [']l'] = '@loop.outer',
    [']s'] = '@statement.outer',
    [']m'] = '@call.outer',
  },
  goto_next_end = {
    [']F'] = '@function.outer',
    [']C'] = '@class.outer',
    [']A'] = '@parameter.inner',
    [']I'] = '@conditional.outer',
    [']L'] = '@loop.outer',
    [']S'] = '@statement.outer',
    [']M'] = '@call.outer',
  },
  goto_previous_start = {
    ['[f'] = '@function.outer',
    ['[c'] = '@class.outer',
    ['[a'] = '@parameter.inner',
    ['[i'] = '@conditional.outer',
    ['[l'] = '@loop.outer',
    ['[s'] = '@statement.outer',
    ['[m'] = '@call.outer',
  },
  goto_previous_end = {
    ['[F'] = '@function.outer',
    ['[C'] = '@class.outer',
    ['[A'] = '@parameter.inner',
    ['[I'] = '@conditional.outer',
    ['[L'] = '@loop.outer',
    ['[S'] = '@statement.outer',
    ['[M'] = '@call.outer',
  },
}

return {
  'nvim-treesitter/nvim-treesitter-textobjects',
  branch = 'main',
  event = 'VeryLazy',
  dependencies = { 'nvim-treesitter/nvim-treesitter' },

  config = function()
    require('nvim-treesitter-textobjects').setup({
      select = { lookahead = true },
      move = { set_jumps = true },
    })

    local select = require('nvim-treesitter-textobjects.select')
    local move = require('nvim-treesitter-textobjects.move')
    local swap = require('nvim-treesitter-textobjects.swap')
    local peek = require('utils.ts_peek')

    for lhs, capture in pairs(select_keymaps) do
      vim.keymap.set(
        { 'x', 'o' },
        lhs,
        function() select.select_textobject(capture, 'textobjects') end,
        { desc = 'Select ' .. capture }
      )
    end

    for direction, keymaps in pairs(move_keymaps) do
      for lhs, capture in pairs(keymaps) do
        vim.keymap.set(
          { 'n', 'x', 'o' },
          lhs,
          function() move[direction](capture, 'textobjects') end,
          { desc = direction:gsub('_', ' ') .. ' ' .. capture }
        )
      end
    end

    -- <leader><Down>/<Up> are taken by tab navigation (config/keymaps.lua)
    vim.keymap.set(
      'n',
      '<leader>cs',
      function() swap.swap_next('@parameter.inner') end,
      { desc = 'Swap parameter next' }
    )
    vim.keymap.set(
      'n',
      '<leader>cS',
      function() swap.swap_previous('@parameter.inner') end,
      { desc = 'Swap parameter previous' }
    )

    vim.keymap.set(
      { 'n', 'x' },
      '<leader>cp',
      function() peek.peek_definition_code('@function.outer') end,
      { desc = 'Peek function definition' }
    )
    vim.keymap.set(
      { 'n', 'x' },
      '<leader>cP',
      function() peek.peek_definition_code('@class.outer') end,
      { desc = 'Peek class definition' }
    )
  end,
}
