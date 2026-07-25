-- Configuration reload utility
local M = {}

-- List of modules to reload
local modules_to_reload = {
  'config.options',
  'config.autocmds',
  'config.commands',
  'config.keymaps',
  'utils.keymap',
  'lsp.handlers',
  'plugins',
}

-- Clear module from package.loaded cache
local function unload_module(module_name)
  package.loaded[module_name] = nil

  -- Also unload submodules
  for loaded_module, _ in pairs(package.loaded) do
    if loaded_module:match('^' .. module_name .. '%.') then package.loaded[loaded_module] = nil end
  end
end

-- Reload all config modules
function M.reload_config()
  -- Unload all modules
  for _, module in ipairs(modules_to_reload) do
    unload_module(module)
  end

  -- Reload main modules
  require('config.options')
  require('config.autocmds')
  require('config.commands')
  require('config.keymaps')

  -- Reload utility modules
  require('utils.keymap')

  -- Print success message
  require('utils.notify').success('Neovim', 'Configuration reloaded successfully!')

  return true
end

return M
