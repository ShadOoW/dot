-- Astro LSP server configuration
local function get_typescript_server_path()
  local mason_root = require('mason.settings').current.install_root_dir
  local possible_paths = { -- Try astro-language-server's own TypeScript first
    mason_root .. '/packages/astro-language-server/node_modules/typescript/lib', -- Fallback to vtsls
    mason_root .. '/packages/vtsls/node_modules/typescript/lib',
    -- Try global TypeScript installation
    '/usr/lib/node_modules/typescript/lib', -- Try local node_modules
    vim.fn.getcwd() .. '/node_modules/typescript/lib',
  }

  for _, path in ipairs(possible_paths) do
    local tsserver_lib = path .. '/tsserverlibrary.js'
    if vim.fn.filereadable(tsserver_lib) == 1 then return path end
  end

  return mason_root .. '/packages/astro-language-server/node_modules/typescript/lib'
end

return {
  filetypes = { 'astro' },
  init_options = {
    typescript = {},
  },
  -- Resolve the tsdk lazily (at server start), not at require time — the
  -- filesystem probing in get_typescript_server_path is not free.
  before_init = function(_, config)
    config.init_options = config.init_options or {}
    config.init_options.typescript = config.init_options.typescript or {}
    if not config.init_options.typescript.tsdk then
      config.init_options.typescript.tsdk = get_typescript_server_path()
    end
  end,
  settings = {
    astro = {
      format = {
        indentFrontmatter = false,
      },
      typescript = {
        enabled = true,
      },
      preferences = {
        quotePreference = 'single',
      },
    },
  },
  single_file_support = true,
}
