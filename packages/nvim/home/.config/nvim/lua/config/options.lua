local notify = require('utils.notify')

vim.g.mapleader = ' '
vim.g.maplocalleader = ' '

-- Set to true if you have a Nerd Font installed and selected in the terminal
vim.g.have_nerd_font = true

vim.opt.number = true
-- You can also add relative line numbers, to help with jumping.
vim.opt.relativenumber = true

-- Enable mouse mode, can be useful for resizing splits for example!
vim.opt.mouse = 'a'

-- Fix mouse menu issues in different modes
vim.opt.mousemodel = 'extend' -- Right-click extends selection instead of showing menu

-- Force statusline to be always visible
-- vim.opt.laststatus = 3 -- Global statusline
-- vim.opt.cmdheight = 1 -- Command line height

-- Ensure menus are available in all modes (fixes E335)
vim.cmd([[
  " Disable problematic menu entries that can cause E335
  if has('gui_running') || has('nvim')
    " Create basic menu structure to prevent E335 errors
    silent! unmenu *
    " Only define essential menus to avoid conflicts
    menu 10.10 &File.&Open<Tab>:e :browse confirm e<CR>
    menu 10.20 &File.&Save<Tab>:w :confirm w<CR>
    menu 10.30 &File.&Close<Tab>:q :confirm q<CR>
  endif
]])

-- Show current mode (kept: this is the effective value; see also lualine)
vim.opt.showmode = true

-- Sync clipboard between OS and Neovim.
--  Schedule the setting after `UiEnter` because it can increase startup-time.
--  Remove this option if you want your OS clipboard to remain independent.
--  See `:help 'clipboard'`
vim.schedule(function() vim.opt.clipboard = 'unnamedplus' end)

-- Enable break indent
vim.opt.breakindent = true

-- Save undo history
vim.opt.undofile = true

-- Case-insensitive searching UNLESS \C or one or more capital letters in the search term
vim.opt.ignorecase = true
vim.opt.smartcase = true

-- Keep signcolumn on by default
vim.opt.signcolumn = 'yes'

-- Add padding/spacing around buffer content on all sides
vim.opt.numberwidth = 8
vim.opt.foldcolumn = '0'
vim.opt.cursorcolumn = false
-- Left/Right padding: Keep columns visible at edges
vim.opt.sidescrolloff = 8

-- Decrease mapped sequence wait time
vim.opt.timeoutlen = 300

-- Configure how new splits should be opened
vim.opt.splitright = true
vim.opt.splitbelow = true

-- Hide native tabline — tab navigation is handled by the left sidebar (tab-sidebar.lua)
vim.opt.showtabline = 0

-- Sets how neovim will display certain whitespace characters in the editor.
--  See `:help 'list'`
--  and `:help 'listchars'`
--
--  Notice listchars is set using `vim.opt` instead of `vim.o`.
--  It is very similar to `vim.o` but offers an interface for conveniently interacting with tables.
--   See `:help lua-options`
--   and `:help lua-options-guide`
vim.opt.list = true
vim.opt.listchars = {
  tab = '» ',
  trail = '·',
  nbsp = '␣',
}

-- Preview substitutions live, as you type!
vim.opt.inccommand = 'split'

-- Show which line your cursor is on
vim.opt.cursorline = true
vim.opt.cursorlineopt = 'line'

-- Disable all scrolling animations
vim.opt.lazyredraw = false
vim.opt.jumpoptions = 'stack'

-- Don't wrap lines
vim.opt.wrap = false

-- Tab settings
vim.opt.tabstop = 2
vim.opt.shiftwidth = 2
vim.opt.expandtab = true

-- File formatting options
-- Let Neovim auto-detect EOL per file; don't modify file endings on save
vim.opt.fixendofline = false
vim.opt.fileformat = 'unix'

-- Better paste behavior to avoid extra empty lines
vim.keymap.set('v', 'p', function()
  -- Store current register content
  local reg_content = vim.fn.getreg('"')
  local reg_type = vim.fn.getregtype('"')

  -- Delete visual selection and paste
  vim.cmd('normal! "_dP')

  -- If the pasted content doesn't end with a newline and we're at buffer start,
  -- remove any extra empty line that might have been created
  local cursor_pos = vim.api.nvim_win_get_cursor(0)
  if cursor_pos[1] == 1 then
    local first_line = vim.api.nvim_buf_get_lines(0, 0, 1, false)[1]
    if first_line == '' then
      local second_line = vim.api.nvim_buf_get_lines(0, 1, 2, false)[1]
      if second_line and second_line ~= '' then vim.api.nvim_buf_set_lines(0, 0, 1, false, {}) end
    end
  end
end, {
  desc = 'Paste in visual mode without extra empty lines',
})

vim.api.nvim_create_autocmd({ 'UIEnter', 'BufReadPost', 'VimResized', 'WinEnter' }, {
  group = vim.api.nvim_create_augroup('FixNumberColumns', { clear = true }),
  callback = function()
    vim.defer_fn(function()
      vim.wo.cursorlineopt = 'line'
      vim.wo.numberwidth = 8
      vim.wo.foldcolumn = '0'
    end, 100)
  end,
})

-- Enable true color support
vim.opt.termguicolors = true

-- Prevent unnamed buffer creation on startup
vim.opt.shortmess:append('I') -- Remove intro message
vim.opt.cmdheight = 0 -- Hide command line when not in use

-- Additional options to prevent unwanted buffer creation
vim.opt.hidden = true -- Allow hidden buffers
vim.opt.confirm = false -- Don't confirm when abandoning buffers

-- Disable netrw completely since we're using telescope file browser
vim.g.loaded_netrw = 1
vim.g.loaded_netrwPlugin = 1

-- Session options ('terminal' excluded: session pre-save deletes terminal buffers)
vim.opt.sessionoptions = 'blank,buffers,curdir,folds,help,tabpages,winsize,winpos'

-- File type associations
vim.filetype.add({
  extension = {
    odin = 'odin',
    dart = 'dart',
  },
  filename = {
    ['ols.json'] = 'jsonc',
    ['odinfmt.json'] = 'jsonc',
    ['pubspec.yaml'] = 'yaml',
    ['pubspec.yml'] = 'yaml',
    ['analysis_options.yaml'] = 'yaml',
    ['analysis_options.yml'] = 'yaml',
  },
})

-- Cursor appearance and cursor highlights live in config/cursor.lua

-- Use latest version of file with enhanced tmux integration
vim.opt.autoread = true

-- Better swap, backup, and undo file management for multi-instance scenarios
vim.opt.swapfile = true
vim.opt.backup = true
vim.opt.writebackup = true
vim.opt.backupcopy = 'auto'

-- Make swap file warnings more discrete
vim.opt.shortmess:append('A') -- Don't show ATTENTION message for existing swap files
vim.opt.updatecount = 200 -- Write swap file after 200 characters
vim.opt.updatetime = 4000 -- Write swap file after 4 seconds of inactivity

-- Handle swap files gracefully with discrete notifications
vim.api.nvim_create_autocmd('SwapExists', {
  group = vim.api.nvim_create_augroup('DiscreteSwapHandling', {
    clear = true,
  }),
  callback = function(args)
    local swap_file = vim.v.swapname
    local file_name = args.file

    -- Show a discrete notification instead of the full dialog
    notify.warn(
      'Swap File',
      string.format(
        'Swap file exists for %s. Press "e" to edit anyway, "r" to recover, "q" to quit.',
        vim.fn.fnamemodify(file_name, ':t')
      )
    )

    -- Set swap choice to 'e' (edit anyway) by default for non-interactive use
    -- User can still choose 'r' to recover or 'q' to quit when prompted
    vim.v.swapchoice = 'e'
  end,
  desc = 'Handle swap files with discrete notifications',
})

-- Create directories if they don't exist
local paths = require('utils.paths')

-- swap and backup are regenerable — route to @home-cache subvolume when available
local swap_dir = paths.cache_path('swap')
local backup_dir = paths.cache_path('backup')

-- undo must stay in stdpath('data') — persistent undo history is never regenerable
local undo_dir = vim.fn.stdpath('data') .. '/undo'
vim.fn.mkdir(undo_dir, 'p')

vim.opt.directory = swap_dir .. '//'
vim.opt.backupdir = backup_dir .. '//'
vim.opt.undodir = undo_dir .. '//'

-- Enhanced focus events for tmux
if vim.env.TMUX then
  -- Better focus detection in tmux
  vim.opt.ttimeoutlen = 10
  vim.opt.ttimeout = true

  -- Enable focus events
  vim.api.nvim_command('set eventignore-=FocusGained')
  vim.api.nvim_command('set eventignore-=FocusLost')
end

-- Clipboard registers are synced via the scheduled `clipboard = 'unnamedplus'`
-- assignment near the top of this file (deferred to keep startup fast).

-- Fix clipboard issues on Linux
if vim.fn.has('linux') == 1 then
  if vim.fn.executable('wl-copy') == 1 and vim.fn.executable('wl-paste') == 1 then
    -- Wayland clipboard with better integration
    vim.g.clipboard = {
      name = 'wl-clipboard',
      copy = {
        ['+'] = 'wl-copy --type text/plain',
        ['*'] = 'wl-copy --type text/plain --primary',
      },
      paste = {
        ['+'] = 'wl-paste --no-newline',
        ['*'] = 'wl-paste --no-newline --primary',
      },
      cache_enabled = 0,
    }
  elseif vim.fn.executable('xclip') == 1 then
    -- X11 clipboard with xclip
    vim.g.clipboard = {
      name = 'xclip',
      copy = {
        ['+'] = 'xclip -selection clipboard',
        ['*'] = 'xclip -selection primary',
      },
      paste = {
        ['+'] = 'xclip -selection clipboard -o',
        ['*'] = 'xclip -selection primary -o',
      },
      cache_enabled = 0,
    }
  elseif vim.fn.executable('xsel') == 1 then
    -- X11 clipboard with xsel
    vim.g.clipboard = {
      name = 'xsel',
      copy = {
        ['+'] = 'xsel --clipboard --input',
        ['*'] = 'xsel --primary --input',
      },
      paste = {
        ['+'] = 'xsel --clipboard --output',
        ['*'] = 'xsel --primary --output',
      },
      cache_enabled = 0,
    }
  end
end
