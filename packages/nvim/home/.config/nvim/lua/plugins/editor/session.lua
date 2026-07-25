-- Enhanced Neovim Session Management
-- Uses persistence.nvim for robust, directory-based session persistence
-- Automatically saves/restores sessions per project directory with no manual intervention
return {
  'folke/persistence.nvim',
  -- Oil loaded on demand when opening dir with no session (not a dep so we load before Oil)
  priority = 10, -- Load before Oil (default 1000) so session restore runs first
  event = { 'BufReadPre', 'VimEnter' }, -- VimEnter needed: nvim . doesn't trigger BufReadPre
  -- persistence.nvim v3 only accepts dir/need/branch; session contents follow
  -- vim.opt.sessionoptions (set in config/options.lua). Pre-save buffer pruning
  -- runs on the User PersistenceSavePre event below; post-restore cleanup lives
  -- in the User PersistenceLoadPost handler in config/autocmds.lua.
  opts = {},

  config = function(_, opts)
    require('persistence').setup(opts)

    -- Prune problematic windows/buffers before the session is written
    vim.api.nvim_create_autocmd('User', {
      pattern = 'PersistenceSavePre',
      group = vim.api.nvim_create_augroup('PersistenceSavePrune', { clear = true }),
      callback = function()
        -- Close floating windows
        for _, win in ipairs(vim.api.nvim_list_wins()) do
          local config = vim.api.nvim_win_get_config(win)
          if config.relative ~= '' then pcall(vim.api.nvim_win_close, win, false) end
        end

        -- Close problematic buffer types that shouldn't be persisted
        local problematic_filetypes = {
          'gitcommit',
          'gitrebase',
          'trouble',
          'neo-tree',
          'startify',
          'TelescopePrompt',
          'lazy',
          'mason',
          'oil',
          'NvimTree',
          'LazyGit',
          'noice',
          'notify',
          'messages',
          'checkhealth',
          'lspinfo',
          'qf',
          'help',
          'sidebar',
          'output',
          'outputpanel',
          'aerial',
          'dapui_console',
          'dapui_watches',
          'dapui_stacks',
          'dapui_breakpoints',
          'dapui_scopes',
          'dap-repl',
        }

        local problematic_buftypes = { 'help', 'quickfix', 'terminal', 'prompt', 'nofile', 'acwrite' }

        for _, buf in ipairs(vim.api.nvim_list_bufs()) do
          if vim.api.nvim_buf_is_valid(buf) then
            local buftype = vim.bo[buf].buftype
            local filetype = vim.bo[buf].filetype
            local bufname = vim.api.nvim_buf_get_name(buf)

            -- Close non-file buffers
            local should_close = vim.tbl_contains(problematic_buftypes, buftype)
              or vim.tbl_contains(problematic_filetypes, filetype)
              or (bufname == '' and buftype == '')

            if should_close then pcall(vim.api.nvim_buf_delete, buf, {
              force = true,
            }) end
          end
        end

        -- Save remaining buffers
        pcall(function() vim.cmd('silent! wall') end)
      end,
      desc = 'Prune problematic buffers before session save',
    })
  end,

  keys = {
    {
      '<leader>Sr',
      function()
        require('persistence').load()
        require('utils.notify').success('Persistence', 'Session restored')
      end,
      desc = 'Restore session for current directory',
    },
    {
      '<leader>Sl',
      function()
        require('persistence').load({
          last = true,
        })
        require('utils.notify').success('Persistence', 'Last session restored')
      end,
      desc = 'Load last session',
    },
    {
      '<leader>Ss',
      function()
        require('persistence').save()
        require('utils.notify').success('Persistence', 'Session saved')
      end,
      desc = 'Save current session',
    },
    {
      '<leader>Sd',
      function()
        require('persistence').stop()
        require('utils.notify').info('Persistence', 'Session persistence disabled')
      end,
      desc = 'Stop session persistence',
    },
  },

  init = function()
    -- Helper function to check if we have meaningful buffers
    local function has_meaningful_buffers()
      for _, buf in ipairs(vim.api.nvim_list_bufs()) do
        if vim.api.nvim_buf_is_loaded(buf) and vim.api.nvim_buf_is_valid(buf) then
          local buftype = vim.api.nvim_get_option_value('buftype', {
            buf = buf,
          })
          local bufname = vim.api.nvim_buf_get_name(buf)

          if buftype == '' and bufname ~= '' and vim.fn.filereadable(bufname) == 1 then return true end
        end
      end
      return false
    end

    local function cleanup_initial_buffer()
      local initial_bufnr = vim.api.nvim_get_current_buf()
      local bufname = vim.api.nvim_buf_get_name(initial_bufnr)
      local filetype = vim.api.nvim_get_option_value('filetype', { buf = initial_bufnr })
      -- Delete if it's the initial directory buffer or [No Name] buffer
      if
        (bufname ~= '' and vim.fn.isdirectory(bufname) == 1 and filetype == '') or (bufname == '' and filetype == '')
      then
        -- Don't delete if it's the only buffer left
        if #vim.api.nvim_list_bufs() > 1 then pcall(vim.api.nvim_buf_delete, initial_bufnr, { force = true }) end
      end
      -- Also clean up any other [No Name] buffers
      for _, buf in ipairs(vim.api.nvim_list_bufs()) do
        if vim.api.nvim_buf_is_valid(buf) and buf ~= initial_bufnr then
          local bname = vim.api.nvim_buf_get_name(buf)
          local btype = vim.api.nvim_get_option_value('filetype', { buf = buf })
          if bname == '' and btype == '' then pcall(vim.api.nvim_buf_delete, buf, { force = true }) end
        end
      end
    end

    local function try_restore_or_open_oil()
      local persistence = require('persistence')
      local session_file = persistence.current()
      if vim.fn.filereadable(session_file) == 0 then session_file = persistence.current({ branch = false }) end
      local initial_bufnr = vim.api.nvim_get_current_buf()
      if session_file ~= '' and vim.fn.filereadable(session_file) == 1 then
        local success = pcall(persistence.load)
        if success then
          require('utils.notify').success('Persistence', 'Session restored')
          vim.schedule(cleanup_initial_buffer)
        end
      else
        local ok, oil = pcall(require, 'oil')
        if ok and oil then oil.open(vim.fn.getcwd(), {}, function() cleanup_initial_buffer() end) end
      end
    end

    -- Auto-restore session when starting with 'nvim .'
    -- Run immediately when we load on VimEnter (autocmd would fire too late - we register during the event)
    local argv = vim.fn.argv()
    local argc = vim.fn.argc()
    local should_restore = argc == 1 and argv[1] == '.' and not vim.env.NVIM and not vim.g.started_with_stdin
    if should_restore then try_restore_or_open_oil() end

    -- Auto-save session on exit
    vim.api.nvim_create_autocmd('VimLeavePre', {
      group = vim.api.nvim_create_augroup('PersistenceAutoSave', {
        clear = true,
      }),
      callback = function()
        if has_meaningful_buffers() then pcall(function() require('persistence').save() end) end
      end,
    })

    -- Detect stdin to avoid auto-restore when using pipes
    vim.api.nvim_create_autocmd('StdinReadPre', {
      group = vim.api.nvim_create_augroup('PersistenceStdinDetect', {
        clear = true,
      }),
      callback = function() vim.g.started_with_stdin = true end,
    })
  end,
}
