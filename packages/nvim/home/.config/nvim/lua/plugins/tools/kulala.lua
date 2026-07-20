-- kulala.nvim: REST/GraphQL/gRPC/WebSocket client using JetBrains .http files.
-- The modern successor to the (once-archived) rest.nvim — 100% .http-spec
-- compatible, with scripting and multi-protocol support.
--
-- Requests live in .http / .rest files. Store them wherever you work; e.g. in
-- /data/code/work/bruce (not a git repo, so nothing there is tracked).
-- Keymaps are buffer-local to .http buffers, under <leader>R — see
-- ftplugin/http.lua. tree-sitter-cli (a kulala dep) is already installed by
-- mason-tool-installer, so it's on Neovim's PATH.
return {
  'mistweaverco/kulala.nvim',
  ft = { 'http', 'rest' },
  init = function()
    -- Resolve .http/.rest to the `http` filetype up front, so the buffer-local
    -- keymaps in ftplugin/http.lua fire (and lazy loads kulala) on open.
    vim.filetype.add({ extension = { http = 'http', rest = 'http' } })
  end,
  opts = {
    display_mode = 'split', -- open responses in a split (not a float)
    default_view = 'body', -- show the response body first (toggle with <leader>Rt)
    default_env = 'local', -- start on localhost:2809 (switch with <leader>Re)
    env_scope = 'g', -- selected env is global: pick once, applies to every .http buffer
  },
}
