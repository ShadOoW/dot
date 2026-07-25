-- LSP servers configuration
return {
  'neovim/nvim-lspconfig',
  dependencies = {
    'hrsh7th/cmp-nvim-lsp',
    'williamboman/mason.nvim',
    'williamboman/mason-lspconfig.nvim',
    -- JSON/YAML schema catalog consumed by lsp/servers/jsonls.lua and yamlls.lua
    { 'b0o/schemastore.nvim', lazy = true },
  },
  event = { 'BufReadPre', 'BufNewFile' },
  config = function()
    -- Guard against double-loading due to lazy.nvim import/require overlap
    if _G.lsp_servers_setup_done then return end
    _G.lsp_servers_setup_done = true

    local handlers = require('lsp.handlers')

    -- Configure diagnostics first
    handlers.setup_diagnostics()

    -- Global config applied to every server
    vim.lsp.config('*', {
      capabilities = require('cmp_nvim_lsp').default_capabilities(),
      on_attach = handlers.on_attach,
    })

    -- Per-server overrides (loaded from lsp/servers/<name>.lua)
    local server_names = require('lsp.servers-list').servers

    for _, name in ipairs(server_names) do
      local ok, server_config = pcall(require, 'lsp.servers.' .. name)
      if ok and server_config and type(server_config) == 'table' then
        -- Force strict opt-in for noisy servers
        if name == 'eslint' or name == 'biome' then server_config.single_file_support = false end
        vim.lsp.config(name, server_config)
      end
    end

    -- Enable only the servers in our explicit list.
    -- automatic_enable is disabled in mason.lua so this is the single enable point.
    vim.lsp.enable(server_names)

    -- Session restore opens buffers via :badd which skips BufReadPre, so FileType
    -- fires before vim.lsp.enable() registers its autocmds. Retrigger now for any
    -- buffer that is already loaded so those files get LSP attached.
    vim.schedule(function()
      for _, buf in ipairs(vim.api.nvim_list_bufs()) do
        if vim.api.nvim_buf_is_loaded(buf) and vim.bo[buf].filetype ~= '' then
          local ft = vim.bo[buf].filetype
          -- Skip non-standard filetypes that don't have LSP/treesitter support
          if
            not vim.tbl_contains({
              'diffview',
              'DiffviewFiles',
              'gitcommit',
              'gitconfig',
              'gitrebase',
            }, ft)
          then
            vim.api.nvim_exec_autocmds('FileType', { buffer = buf, modeline = false })
          end
        end
      end
    end)

    -- Start the LSP guard: enforces filetype rules and detects mason orphans.
    require('lsp.guard').setup()

    -- Force HTML filetype detection for consistency
    vim.api.nvim_create_autocmd({ 'BufRead', 'BufNewFile' }, {
      pattern = { '*.html', '*.htm', '*.xhtml' },
      callback = function(args)
        vim.bo[args.buf].filetype = 'html'
        vim.schedule(function() vim.cmd('TSBufEnable highlight') end)
      end,
      desc = 'Force HTML filetype detection for consistent LSP/treesitter behavior',
    })
  end,
}
