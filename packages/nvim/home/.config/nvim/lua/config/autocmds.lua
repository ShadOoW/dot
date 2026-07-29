local notify = require('utils.notify')

local panel_group = vim.api.nvim_create_augroup('panel-management', {
  clear = true,
})

vim.api.nvim_create_autocmd('FileType', {
  group = panel_group,
  pattern = '*',
  callback = function()
    -- List of filetypes that should be treated as panels/windows
    local panel_filetypes = {
      'qf', -- Quickfix
      'help', -- Help files
      'fugitive', -- Git windows
      'git', -- Git windows
      'neotest-summary', -- Test summary
      'neotest-output', -- Test output
      'tsplayground', -- Treesitter playground
      'lspinfo', -- LSP info
      'spectre_panel', -- Search/replace
      'startuptime', -- Startup time
      'aerial', -- Symbol outline
      'neotest-output-panel', -- Test output panel
      'checkhealth', -- Health check
      'man', -- Man pages
      'diagnostics', -- Diagnostic windows
      'DiffviewFiles', -- Diffview files
      'DiffviewFileHistory', -- Diffview history
      'Outline', -- Symbol outline
      'trouble', -- Diagnostics
      'sagaoutline', -- LSP Saga outline
    }

    -- Check if current buffer should be treated as a panel
    local is_panel = vim.tbl_contains(panel_filetypes, vim.bo.filetype)
      or (vim.bo.buftype ~= '' and vim.bo.buftype ~= 'terminal')

    if is_panel then
      -- Set buffer-local mapping for 'q' to close the window
      vim.keymap.set('n', 'q', '<cmd>close<CR>', {
        buffer = true,
        silent = true,
        desc = 'Close panel with q',
      })
    end
  end,
  desc = 'Set up panel closing behavior',
})

-- Ensure TSX/JSX filetypes are properly detected
vim.api.nvim_create_autocmd({ 'BufRead', 'BufNewFile' }, {
  pattern = { '*.tsx', '*.jsx' },
  callback = function(args)
    local ext = vim.fn.expand('<afile>:e')
    if ext == 'tsx' then
      vim.bo.filetype = 'typescriptreact'
    elseif ext == 'jsx' then
      vim.bo.filetype = 'javascriptreact'
    end
  end,
  desc = 'Detect TSX/JSX file types',
})

-- Highlight when yanking (copying) text
--  Try it with `yap` in normal mode
--  See `:help vim.hl.on_yank()`
vim.api.nvim_create_autocmd('TextYankPost', {
  desc = 'Highlight when yanking (copying) text',
  group = vim.api.nvim_create_augroup('highlight-yank', {
    clear = true,
  }),
  callback = function() vim.hl.on_yank() end,
})

-- Return to last edit position when opening files
vim.api.nvim_create_autocmd('BufReadPost', {
  callback = function()
    local mark = vim.api.nvim_buf_get_mark(0, '"')
    local lcount = vim.api.nvim_buf_line_count(0)
    if mark[1] > 0 and mark[1] <= lcount then pcall(vim.api.nvim_win_set_cursor, 0, mark) end
  end,
})

-- Enhanced file auto-reload for tmux/multi-instance scenarios
local file_reload_group = vim.api.nvim_create_augroup('file-auto-reload', {
  clear = true,
})

-- Check for file changes when gaining focus or entering buffers
vim.api.nvim_create_autocmd({ 'FocusGained', 'BufEnter', 'CursorHold', 'CursorHoldI' }, {
  group = file_reload_group,
  desc = 'Check for file changes and reload if buffer is unchanged',
  callback = function(event)
    local buf = event.buf

    -- Skip if buffer is not a file or is modified
    if vim.bo[buf].buftype ~= '' or vim.bo[buf].modified then return end

    -- Skip if file doesn't exist
    local file_path = vim.api.nvim_buf_get_name(buf)
    if file_path == '' or vim.fn.filereadable(file_path) == 0 then return end

    -- Check if file has been modified externally
    vim.cmd('checktime')
  end,
})

-- Auto-reload files when they change externally (only if buffer is unmodified)
vim.api.nvim_create_autocmd('FileChangedShellPost', {
  group = file_reload_group,
  desc = 'Notify when file is reloaded due to external changes',
  callback = function()
    local file_name = vim.fn.expand('<afile>')
    notify.info('File Auto-Reload', 'File reloaded: ' .. vim.fn.fnamemodify(file_name, ':~'))
  end,
})

-- Force redraw when re-focusing from tmux (FocusGained only, not BufEnter)
if os.getenv('TMUX') then
  vim.api.nvim_create_autocmd('FocusGained', {
    group = file_reload_group,
    desc = 'Force redraw on tmux focus regain',
    callback = function() vim.cmd('redraw!') end,
  })
end

-- Terminal focus handling for better tmux integration
vim.api.nvim_create_autocmd('TermEnter', {
  group = file_reload_group,
  desc = 'Handle terminal enter events in tmux',
  callback = function()
    -- Check for file changes when entering terminal mode
    vim.schedule(function() vim.cmd('checktime') end)
  end,
})

-- Enhanced auto-indent and split tags on <CR> in web framework files (excluding pure HTML)
vim.api.nvim_create_autocmd('FileType', {
  pattern = { 'xml', 'typescriptreact', 'javascriptreact', 'tsx', 'jsx', 'astro', 'vue', 'svelte' },
  callback = function()
    -- Auto-split tags for frameworks (HTML handled separately for superhtml compatibility)
    vim.keymap.set('i', '<CR>', function()
      local row, col = unpack(vim.api.nvim_win_get_cursor(0))
      local line = vim.api.nvim_get_current_line()
      if col > 0 and line:sub(col, col) == '>' and line:sub(col + 1, col + 1) == '<' then
        return '<CR><CR><Up><C-f>'
      else
        return '<CR>'
      end
    end, {
      expr = true,
      buffer = true,
      desc = 'Auto-split tags in web frameworks',
    })

    -- Enable embedded language highlighting
    vim.bo.suffixesadd = '.js,.ts,.css,.scss,.less'

    -- Set specific options for better web development
    vim.bo.shiftwidth = 2
    vim.bo.tabstop = 2
    vim.bo.softtabstop = 2
    vim.bo.expandtab = true
  end,
  desc = 'Configure web framework files (excluding HTML for superhtml compatibility)',
})

-- Web filetypes used to opt into buffer-local virtual_text diagnostics here.
-- They now use the same display as everything else (utils/noise.lua): stacking
-- a per-buffer override on top of the global virtual_lines drew every message
-- twice, once beside the code and once beneath it.

-- Window management for better tmux integration
local window_group = vim.api.nvim_create_augroup('window-management', {
  clear = true,
})

-- Automatically equalize splits when terminal is resized
vim.api.nvim_create_autocmd('VimResized', {
  group = window_group,
  desc = 'Automatically equalize splits when terminal is resized',
  callback = function()
    pcall(vim.cmd, 'wincmd =') -- Guard against E36 when not enough room
  end,
})

-- Cursorline management: enable on the focused window, disable on leave
vim.api.nvim_create_autocmd({ 'WinEnter', 'BufEnter' }, {
  group = window_group,
  desc = 'Enable cursorline on focused window',
  callback = function()
    local ok, err = pcall(function()
      if vim.api.nvim_win_get_height(0) < 2 or vim.api.nvim_win_get_width(0) < 2 then return end
      vim.wo.cursorline = true
    end)
    if not ok and err and not tostring(err):match('E36') then vim.notify(tostring(err), vim.log.levels.WARN) end
  end,
})

vim.api.nvim_create_autocmd('WinLeave', {
  group = window_group,
  desc = 'Handle window leave events',
  callback = function()
    -- Dim cursor line when leaving a window
    vim.wo.cursorline = false
  end,
})

-- Auto-trim trailing whitespace on save (for mini.trailspace)
local trailspace_group = vim.api.nvim_create_augroup('trailspace-management', {
  clear = true,
})

vim.api.nvim_create_autocmd('BufWritePre', {
  group = trailspace_group,
  pattern = '*',
  callback = function()
    -- Skip certain filetypes where trailing whitespace might be meaningful
    local skip_filetypes = { 'markdown', 'text', 'diff', 'gitcommit' }

    if not vim.tbl_contains(skip_filetypes, vim.bo.filetype) then require('mini.trailspace').trim() end
  end,
  desc = 'Trim trailing whitespace on save',
})

-- Enhanced HTML5 compliance for superhtml
vim.api.nvim_create_autocmd('FileType', {
  group = trailspace_group,
  pattern = { 'html', 'htm', 'xhtml' },
  callback = function()
    -- Ensure HTML files follow HTML5 standards for superhtml
    vim.bo.shiftwidth = 2
    vim.bo.tabstop = 2
    vim.bo.softtabstop = 2
    vim.bo.expandtab = true

    -- Set buffer options for HTML5 compliance
    vim.bo.textwidth = 120 -- Match superhtml wrapLineLength

    -- Enhanced keymap for HTML5 void elements (self-closing tags that shouldn't close)
    vim.keymap.set('i', '<CR>', function()
      local row, col = unpack(vim.api.nvim_win_get_cursor(0))
      local line = vim.api.nvim_get_current_line()
      local before_cursor = line:sub(1, col)
      local after_cursor = line:sub(col + 1)

      -- Check for HTML5 void elements that should NOT be self-closing
      local void_elements = {
        'area',
        'base',
        'br',
        'col',
        'embed',
        'hr',
        'img',
        'input',
        'link',
        'meta',
        'source',
        'track',
        'wbr',
      }

      -- Enhanced tag splitting for proper HTML5 formatting
      if col > 0 and before_cursor:match('<%w+[^>]*>$') and after_cursor:match('^</%w+>') then
        -- Split between opening and closing tags
        return '<CR><CR><Up><C-f>'
      elseif before_cursor:match('<(' .. table.concat(void_elements, '|') .. ')[^>]*/>$') then
        -- Convert self-closing void elements to proper HTML5 format
        local element = before_cursor:match('<(%w+)')
        if element and vim.tbl_contains(void_elements, element) then
          -- Remove the slash from void elements (HTML5 standard)
          local new_line = before_cursor:gsub('/>$', '>')
          vim.api.nvim_set_current_line(new_line .. after_cursor)
          vim.api.nvim_win_set_cursor(0, { row, #new_line })
        end
        return '<CR>'
      else
        return '<CR>'
      end
    end, {
      expr = true,
      buffer = true,
      desc = 'Enhanced HTML5-compliant tag splitting',
    })
  end,
  desc = 'Configure HTML files for superhtml and HTML5 compliance',
})

-- Enhanced session post-load handling: Clean up unwanted buffers/windows and conditionally open Lazy/Mason
-- (single owner of post-restore cleanup; persistence.nvim v3 fires this event itself)
vim.api.nvim_create_autocmd('User', {
  pattern = 'PersistenceLoadPost',
  callback = function()
    -- Delete restored panel buffers (trouble/lazy/mason/...), [No Name] buffers,
    -- and the initial folder buffer from `nvim .` (persists after session restore)
    for _, buf in ipairs(vim.api.nvim_list_bufs()) do
      if vim.api.nvim_buf_is_valid(buf) then
        local bufname = vim.api.nvim_buf_get_name(buf)
        local buftype = vim.bo[buf].buftype
        local filetype = vim.bo[buf].filetype
        local is_initial_folder_buf = bufname ~= ''
          and vim.fn.isdirectory(bufname) == 1
          and filetype == ''
          and buftype == ''
        local is_no_name_buf = bufname == '' and buftype == '' and filetype == ''
        if
          filetype == 'trouble'
          or filetype == 'exclusive-panel'
          or filetype == 'lazy'
          or filetype == 'mason'
          or is_no_name_buf
          or is_initial_folder_buf
        then
          pcall(vim.api.nvim_buf_delete, buf, { force = true })
        end
      end
    end

    -- First, close any problematic windows that might have been restored
    for _, win in ipairs(vim.api.nvim_list_wins()) do
      local buf = vim.api.nvim_win_get_buf(win)
      local filetype = vim.bo[buf].filetype or ''
      local buftype = vim.bo[buf].buftype or ''

      -- Close floating windows and specific problematic buffers
      local config = vim.api.nvim_win_get_config(win)
      if
        config.relative ~= ''
        or filetype == 'trouble'
        or filetype == 'noice'
        or filetype == 'lazy'
        or filetype == 'mason'
      then
        pcall(vim.api.nvim_win_close, win, true)
      end
    end

    -- Check if we need to open Lazy or Mason conditionally
    vim.schedule(function()
      local session_utils = require('utils.session')
      local action = session_utils.get_post_session_action()

      if action == 'lazy' then
        vim.defer_fn(function()
          vim.cmd('Lazy')
          notify.info('Session Restore', 'Lazy opened - pending plugin operations detected')
        end, 150)
      elseif action == 'mason' then
        vim.defer_fn(function()
          vim.cmd('Mason')
          notify.info('Session Restore', 'Mason opened - pending tool installations detected')
        end, 150)
      end
    end)
  end,
  desc = 'Clean up problematic windows and conditionally open Lazy/Mason after session restore',
})

-- Clear vim errors on cmdline leave (Noice already displays msg_show.emsg in panel)
vim.api.nvim_create_autocmd('CmdlineLeave', {
  group = vim.api.nvim_create_augroup('error-notifications', {
    clear = true,
  }),
  callback = function()
    if vim.v.errmsg and vim.v.errmsg ~= '' then vim.v.errmsg = '' end
  end,
})
