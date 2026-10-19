-- kitty-scrollback.nvim: kitty's scrollback, with its ANSI colours, in Neovim.
--
-- lazy.nvim is only the installer and pinner here (lazy-lock.json). kitty
-- launches the pager with `--clean -u ~/.config/kitty/kitty-scrollback-nvim.lua`
-- (packages/kitty), which appends this checkout to the runtimepath and holds
-- the pager's plugin options, so this config -- and its startup work -- never
-- loads there. The spec below only serves the plugin's commands from here.
return {
  'mikesmithgh/kitty-scrollback.nvim',
  lazy = true,
  cmd = { 'KittyScrollbackGenerateKittens', 'KittyScrollbackCheckHealth', 'KittyScrollbackGenerateCommandLineEditing' },
  event = { 'User KittyScrollbackLaunch' },
  config = function() require('kitty-scrollback').setup() end,
}
