-- Toggle the `"void": true|false` flag of the .http request under the cursor and
-- highlight write-mode requests, so firing a real Parse `order` (bruce) is never a
-- surprise. void=true is a dry-run (computed, not persisted); void=false persists.
-- Wired up per-buffer by ftplugin/http.lua.
local M = {}

local NS = vim.api.nvim_create_namespace('http_void')

-- tokyonight red / green, defined with default=true so a user override wins.
local function ensure_highlights()
  vim.api.nvim_set_hl(0, 'HttpVoidWrite', { fg = '#f7768e', bold = true, default = true })
  vim.api.nvim_set_hl(0, 'HttpVoidDry', { fg = '#9ece6a', italic = true, default = true })
end

-- First/last line (0-indexed) of the request block containing `line`, delimited by
-- `###` separators or the buffer edges.
local function block_range(bufnr, line)
  local total = vim.api.nvim_buf_line_count(bufnr)
  local first = 0
  for l = line, 0, -1 do
    local text = vim.api.nvim_buf_get_lines(bufnr, l, l + 1, false)[1] or ''
    if text:match('^###') then
      first = l
      break
    end
  end
  local last = total - 1
  for l = line + 1, total - 1 do
    local text = vim.api.nvim_buf_get_lines(bufnr, l, l + 1, false)[1] or ''
    if text:match('^###') then
      last = l - 1
      break
    end
  end
  return first, last
end

-- Repaint the whole-line danger highlight + eol tag for every `void` line.
function M.refresh(bufnr)
  bufnr = bufnr or vim.api.nvim_get_current_buf()
  if not vim.api.nvim_buf_is_valid(bufnr) then return end
  ensure_highlights()
  vim.api.nvim_buf_clear_namespace(bufnr, NS, 0, -1)
  local lines = vim.api.nvim_buf_get_lines(bufnr, 0, -1, false)
  for i, text in ipairs(lines) do
    local value = text:match('"void"%s*:%s*(%a+)')
    if value == 'false' then
      vim.api.nvim_buf_set_extmark(bufnr, NS, i - 1, 0, {
        line_hl_group = 'HttpVoidWrite',
        virt_text = { { '  WRITES TO DB', 'HttpVoidWrite' } },
        virt_text_pos = 'eol',
      })
    elseif value == 'true' then
      vim.api.nvim_buf_set_extmark(bufnr, NS, i - 1, 0, {
        virt_text = { { '  dry-run', 'HttpVoidDry' } },
        virt_text_pos = 'eol',
      })
    end
  end
end

-- Flip the `void` value of the request under the cursor and repaint.
function M.toggle()
  local bufnr = vim.api.nvim_get_current_buf()
  local cursor = vim.api.nvim_win_get_cursor(0)[1] - 1
  local first, last = block_range(bufnr, cursor)
  for l = first, last do
    local text = vim.api.nvim_buf_get_lines(bufnr, l, l + 1, false)[1] or ''
    local value = text:match('"void"%s*:%s*(%a+)')
    if value == 'true' or value == 'false' then
      local next_value = value == 'true' and 'false' or 'true'
      local new_text = text:gsub('("void"%s*:%s*)%a+', '%1' .. next_value, 1)
      vim.api.nvim_buf_set_lines(bufnr, l, l + 1, false, { new_text })
      M.refresh(bufnr)
      local notify = require('utils.notify')
      if next_value == 'false' then
        notify.warn('http', 'void = false — this request WILL write to the database')
      else
        notify.success('http', 'void = true — dry-run (no writes)')
      end
      return
    end
  end
  require('utils.notify').warn('http', 'No "void" field in this request')
end

-- Paint now and repaint on edits; buffer-local.
function M.attach(bufnr)
  bufnr = bufnr or vim.api.nvim_get_current_buf()
  M.refresh(bufnr)
  local group = vim.api.nvim_create_augroup('http_void_' .. bufnr, { clear = true })
  vim.api.nvim_create_autocmd({ 'TextChanged', 'TextChangedI', 'InsertLeave', 'BufWinEnter' }, {
    group = group,
    buffer = bufnr,
    callback = function() M.refresh(bufnr) end,
  })
end

return M
