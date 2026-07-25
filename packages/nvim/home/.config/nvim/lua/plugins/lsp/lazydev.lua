-- Enhanced Lua development for Neovim configuration (modern replacement for neodev)
return {
  'folke/lazydev.nvim',
  ft = 'lua',
  opts = {
    library = { -- Load luv types when the `vim.uv` word is found
      {
        path = '${3rd}/luv/library',
        words = { 'vim%.uv' },
      }, -- Load luvit types when the `vim.loop` word is found
      {
        path = '${3rd}/luv/library',
        words = { 'vim%.loop' },
      }, -- Always load the lazy.nvim library
      'lazy.nvim',
    },
    -- always enable unless `vim.g.lazydev_enabled = false`
    -- This is the default
    enabled = function(root_dir)
      -- Enable for any lua project with a .luarc.json
      return vim.g.lazydev_enabled ~= false and vim.uv.fs_stat(root_dir .. '/.luarc.json')
    end,
  },
}
