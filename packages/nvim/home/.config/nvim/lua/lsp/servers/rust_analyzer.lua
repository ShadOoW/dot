return {
  settings = {
    ['rust-analyzer'] = {
      cargo = {
        allFeatures = true,
        loadOutDirsFromCheck = true,
        buildScripts = { enable = true },
      },
      -- Use clippy instead of cargo check for richer diagnostics.
      checkOnSave = true,
      check = {
        command = 'clippy',
        extraArgs = { '--no-deps' },
      },
      procMacro = {
        enable = true,
        -- Silence noisy proc-macro warnings from common async crates.
        ignored = {
          ['async-trait'] = { 'async_trait' },
          ['napi-derive'] = { 'napi' },
          ['async-recursion'] = { 'async_recursion' },
        },
      },
      rustfmt = {
        enable = true,
        rangeFormatting = { enable = true },
      },
      -- Which hints are on depends on the current level; utils/noise.lua owns
      -- the profiles and re-pushes them on <leader>ch.
      inlayHints = require('utils.noise').ra_inlay_hints(),
      diagnostics = {
        disabled = { 'unlinked-file' },
        experimental = { enable = true },
      },
      completion = {
        -- Never synthesise a call: completing a function that is being *passed*
        -- as an argument would otherwise insert `()` (or worse, placeholder
        -- arguments) and the fix costs more keystrokes than typing the name.
        callable = { snippets = 'none' },
        postfix = { enable = true },
      },
      imports = {
        granularity = { group = 'module' },
        prefix = 'self',
      },
      workspace = {
        symbol = { search = { kind = 'all_symbols' } },
      },
    },
  },

  -- Chain the global on_attach so inlay hints / doc highlights still apply,
  -- then add rust-specific keymaps.
  on_attach = function(client, bufnr)
    require('lsp.handlers').on_attach(client, bufnr)

    local function map(key, fn, desc) vim.keymap.set('n', key, fn, { buffer = bufnr, desc = 'Rust: ' .. desc }) end

    -- ── LSP / rust-analyzer workspace commands ───────────────────────────────
    map(
      '<leader>re',
      function() client:exec_cmd({ command = 'rust-analyzer.expandMacro' }, { bufnr = bufnr }) end,
      'Expand macro'
    )

    map(
      '<leader>rp',
      function() client:exec_cmd({ command = 'rust-analyzer.parentModule' }, { bufnr = bufnr }) end,
      'Go to parent module'
    )

    map(
      '<leader>ro',
      function() client:exec_cmd({ command = 'rust-analyzer.openDocs' }, { bufnr = bufnr }) end,
      'Open docs in browser'
    )

    map(
      '<leader>rj',
      function() client:exec_cmd({ command = 'rust-analyzer.joinLines' }, { bufnr = bufnr }) end,
      'Join lines (smart)'
    )

    map('<leader>rw', function()
      client:exec_cmd({ command = 'rust-analyzer.reloadWorkspace' }, { bufnr = bufnr })
      require('utils.notify').info('Rust', 'Workspace reloaded')
    end, 'Reload workspace')

    -- ── Cargo commands in a horizontal terminal split ────────────────────────
    local root = client.config.root_dir or vim.fn.getcwd()

    local function cargo(subcmd, desc)
      map(
        '<leader>r' .. subcmd:sub(1, 1),
        function() require('toggleterm').exec('cargo ' .. subcmd, 1, 15, root, 'horizontal') end,
        'cargo ' .. desc
      )
    end

    cargo('run', 'run')
    cargo('test', 'test')
    cargo('build', 'build')
    -- clippy uses <leader>rk (k for check+clippy, c is taken by 'cargo check')
    map(
      '<leader>rk',
      function() require('toggleterm').exec('cargo clippy --all-targets --all-features', 1, 15, root, 'horizontal') end,
      'cargo clippy'
    )
  end,
}
