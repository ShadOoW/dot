return {
  'WhoIsSethDaniel/mason-tool-installer.nvim',
  dependencies = { 'williamboman/mason.nvim' },
  event = 'VeryLazy',
  config = function()
    require('mason-tool-installer').setup({
      ensure_installed = { -- LSP Servers
        -- Web Development
        'css-lsp', -- CSS
        'vtsls', -- Modern TypeScript/JavaScript
        'eslint-lsp', -- ESLint
        -- 'tailwindcss-language-server', -- Tailwind CSS (removed)
        'astro-language-server', -- Astro
        'unocss-language-server', -- UnoCSS
        'svelte-language-server', -- Svelte
        'vue-language-server', -- Vue
        'angular-language-server', -- Angular
        'lit-plugin', -- Lit (Web Components)
        'htmx-lsp', -- HTMX support
        'superhtml', -- Better HTML validation (new!)
        -- Data & Configuration
        'json-lsp', -- JSON
        'yaml-language-server', -- YAML
        'taplo', -- TOML
        -- Markdown & Documentation
        'marksman', -- Markdown
        'harper-ls', -- Grammar checking
        -- General Development
        'lua-language-server', -- Lua
        'bash-language-server', -- Bash
        'dockerfile-language-server', -- Docker
        'docker-compose-language-service', -- Docker
        'rust-analyzer', -- Rust Language Server
        'ols', -- Odin Language Server
        -- Mobile Development
        'dart-language-server', -- Dart/Flutter LSP
        -- Linters
        -- Web Development
        'eslint_d', -- Fast ESLint
        'biome', -- Modern linter/formatter (replaces eslint for some cases)
        'stylelint', -- CSS/SCSS linter
        'htmlhint', -- HTML linter
        'alex', -- Inclusive language linter
        -- General
        'shellcheck', -- Shell script linter
        'vale', -- Prose linter
        'codespell', -- Spell checker
        'gitlint', -- Git commit linter
        'yamllint', -- YAML linter
        'jsonlint', -- JSON linter
        -- Markdown
        'markdownlint', -- Markdown linter
        'textlint', -- Text linter
        -- Formatters
        -- Web Development
        'prettier', -- Universal formatter
        'prettierd', -- Fast Prettier daemon
        'biome', -- Fast JS/TS/JSON/CSS formatter (modern alternative)
        'rustywind', -- Tailwind class sorter
        'dprint', -- Fast formatter
        -- General
        'stylua', -- Lua formatter
        'shfmt', -- Shell script formatter
        'black', -- Python formatter
        'isort', -- Python import sorter
        'ruff', -- Python linter (replaces flake8)
        -- CSS/SCSS
        'stylelint-lsp', -- CSS/SCSS formatter
        -- SQL
        'sql-formatter', -- SQL formatter
        -- YAML
        'yamlfix', -- YAML formatter
        -- Additional Modern Tools
        'tree-sitter-cli', -- Tree-sitter CLI
        'kulala-fmt', -- .http/.rest formatter (conform: http filetype)
        'grammarly-languageserver', -- Grammarly integration
        'ltex-ls', -- LaTeX/Markdown grammar checker
        'odinfmt', -- Odin formatter
      },
      auto_update = true,
      run_on_start = true,
      start_delay = 3000, -- 3 second delay
      debounce_hours = 5, -- at least 5 hours between attempts
    })
  end,
}
