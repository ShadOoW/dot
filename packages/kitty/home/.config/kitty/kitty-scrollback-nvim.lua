-- The whole Neovim config for kitty's scrollback pager (kitty.conf's
-- `kitty_scrollback_nvim` alias runs `nvim -u` on this file). The real nvim
-- config never loads here, so nothing it starts at boot follows it in.

-- `y` yanks to the Wayland clipboard, as in any other copy mode.
vim.opt.clipboard = 'unnamedplus'
vim.opt.ignorecase = true
vim.opt.smartcase = true

-- lazy.nvim installs and pins the plugin for packages/nvim; reuse that
-- checkout instead of keeping a second copy.
vim.opt.runtimepath:append(vim.fn.expand('~/.cache/managed-nvim/lazy/kitty-scrollback.nvim'))
require('kitty-scrollback').setup({
  {
    -- Plain `y` used to open the plugin's paste window, a floating editor
    -- for sending text back to kitty. Selecting and pressing <S-CR> still
    -- does that; yanking is for copying.
    paste_window = { yank_register_enabled = false },
  },
})
