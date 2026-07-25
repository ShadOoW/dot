-- yanky.nvim: Improved yank and put functionality
return {
  'gbprod/yanky.nvim',
  event = 'VeryLazy',
  config = function()
    -- Basic yanky setup without telescope-specific options
    require('yanky').setup({
      ring = {
        history_length = 100,
        storage = 'memory',
        sync_with_numbered_registers = true,
        cancel_event = 'update',
      },
      picker = {
        select = {
          action = nil, -- Use default action
        },
      },
      system_clipboard = {
        sync_with_ring = true,
      },
      highlight = {
        on_put = true,
        on_yank = true,
        timer = 500,
      },
      preserve_cursor_position = {
        enabled = true,
      },
    })

    -- Basic yanky mappings (these don't depend on telescope)
    vim.keymap.set({ 'n', 'x' }, 'y', '<Plug>(YankyYank)', {
      desc = 'Yank text',
    })

    -- Global p/P maps (defined once); git buffers get the native put back below
    vim.keymap.set({ 'n', 'x' }, 'p', '<Plug>(YankyPutAfter)', {
      desc = 'Put after cursor',
    })
    vim.keymap.set({ 'n', 'x' }, 'P', '<Plug>(YankyPutBefore)', {
      desc = 'Put before cursor',
    })
    vim.api.nvim_create_autocmd('FileType', {
      pattern = 'git',
      group = vim.api.nvim_create_augroup('YankyGitException', { clear = true }),
      callback = function(args)
        vim.keymap.set({ 'n', 'x' }, 'p', 'p', { buffer = args.buf, desc = 'Put after cursor (native)' })
        vim.keymap.set({ 'n', 'x' }, 'P', 'P', { buffer = args.buf, desc = 'Put before cursor (native)' })
      end,
      desc = 'Use native put in git buffers',
    })

    -- <C-p> belongs to the fzf-lua file finder; cycle on Alt instead
    vim.keymap.set('n', '<M-n>', '<Plug>(YankyCycleForward)', {
      desc = 'Cycle forward through yank history',
    })
    vim.keymap.set('n', '<M-p>', '<Plug>(YankyCycleBackward)', {
      desc = 'Cycle backward through yank history',
    })
  end,
}
