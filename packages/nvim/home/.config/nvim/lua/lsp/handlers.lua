-- LSP handlers
local M = {}

-- Setup shared capabilities for LSP servers (handled in lsp.setup.lua)
-- M.capabilities = require('cmp_nvim_lsp').default_capabilities() or vim.lsp.protocol.make_client_capabilities()

-- Servers that benefit from project-wide diagnostic population.
-- Populated lazily (on first <leader>xd open) to avoid disrupting startup
-- highlighting.  See M.populate_workspace_diagnostics_for_buf below.
M.workspace_diag_servers = { 'vtsls', 'basedpyright', 'rust_analyzer', 'gopls' }

-- Track which clients have already had a startup token-refresh scheduled.
local _token_refresh_scheduled = {}

-- Setup keymaps for LSP
---@param client vim.lsp.Client
---@param bufnr number
function M.on_attach(client, bufnr)
  local keymap = require('utils.keymap')

  -- These servers send incomplete semantic tokens while still initialising
  -- (path aliases / full type graph not yet resolved).  They DO send
  -- workspace/semanticTokens/refresh once analysis is complete, but the
  -- first buffer — opened before the server is ready — can be left with
  -- stale tokens because the refresh arrives before Neovim has queued the
  -- re-request.  We watch LspProgress and force-refresh the first buffer
  -- once the server goes idle, guaranteeing it gets up-to-date tokens.
  -- `seen_begin` prevents misfires from stale `end` events that arrive
  -- before our handler is registered.
  if vim.tbl_contains(M.workspace_diag_servers, client.name) and not _token_refresh_scheduled[client.id] then
    _token_refresh_scheduled[client.id] = true
    local pending = {}
    local seen_begin = false
    local group = vim.api.nvim_create_augroup('lsp_tokens_ready_' .. client.id, { clear = true })

    vim.api.nvim_create_autocmd('LspProgress', {
      group = group,
      callback = function(ev)
        if ev.data.client_id ~= client.id then return end
        local token = ev.data.result and ev.data.result.token
        local value = ev.data.result and ev.data.result.value
        if not token or not value then return end
        if value.kind == 'begin' then
          seen_begin = true
          pending[token] = true
        elseif value.kind == 'end' then
          pending[token] = nil
          if seen_begin and vim.tbl_isempty(pending) then
            vim.schedule(function()
              -- A new phase may have started between the `end` event and now;
              -- if so, bail and let the next idle trigger handle it.
              if not vim.tbl_isempty(pending) then return end
              pcall(vim.api.nvim_del_augroup_by_id, group)
              if vim.api.nvim_buf_is_valid(bufnr) and vim.lsp.buf_is_attached(bufnr, client.id) then
                pcall(vim.lsp.semantic_tokens.force_refresh, bufnr)
              end
            end)
          end
        end
      end,
    })
  end

  -- Create a buffer-specific keymap function
  local function buf_map(mode, lhs, rhs, desc)
    vim.keymap.set(mode, lhs, rhs, {
      buffer = bufnr,
      desc = 'LSP: ' .. desc,
    })
  end

  -- Inlay hints (if supported).  Levels and the server-side hint profiles live
  -- in utils/noise.lua so every inline decoration is configured in one place.
  if client.server_capabilities.inlayHintProvider then
    local noise = require('utils.noise')
    noise.apply_hints(client)

    -- <leader>c prefix (Code); <leader>t is reserved for tab management
    buf_map('n', '<leader>ch', noise.cycle_hints, 'Cycle Inlay [H]ints')
  end

  -- Document highlight is handled by vim-illuminate (plugins/ui/cursorline.lua)
end

-- Populate workspace diagnostics for all relevant clients attached to bufnr.
-- The workspace-diagnostics plugin is idempotent per client (_loaded_clients
-- guard), so calling this multiple times is safe.  Called lazily from the
-- diagnostics panel keybinding rather than eagerly on startup, so it never
-- runs while the LSP is still initialising and disrupting highlights.
function M.populate_workspace_diagnostics_for_buf(bufnr)
  bufnr = bufnr or vim.api.nvim_get_current_buf()
  local ok, wd = pcall(require, 'workspace-diagnostics')
  if not ok then return end
  for _, client in ipairs(vim.lsp.get_clients({ bufnr = bufnr })) do
    if vim.tbl_contains(M.workspace_diag_servers, client.name) then wd.populate_workspace_diagnostics(client, bufnr) end
  end
end

-- Configure diagnostics.  Owned by utils/noise.lua, which keeps the inline
-- display (virtual lines, deduplication, insert-mode suppression) in the same
-- place as the inlay-hint and ghost-text levels.
function M.setup_diagnostics() require('utils.noise').setup() end

return M
