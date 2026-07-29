vim.opt_local.expandtab = true
vim.opt_local.tabstop = 4
vim.opt_local.softtabstop = 4
vim.opt_local.shiftwidth = 4

vim.opt_local.syntax = 'on'

vim.opt_local.commentstring = '// %s'

vim.opt_local.smartindent = true
vim.opt_local.autoindent = true

vim.opt_local.spell = true
vim.opt_local.spelllang = { 'en_us' }
-- Split camelCase/PascalCase before checking, so identifiers quoted in strings
-- and doc comments stop drawing red squiggles under correctly spelled code.
vim.opt_local.spelloptions = 'camel'

vim.opt_local.textwidth = 100

vim.opt_local.wrap = false
