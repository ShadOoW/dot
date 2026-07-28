-- Peek definition code, which the nvim-treesitter-textobjects rewrite ('main')
-- dropped along with the rest of its lsp_interop module.
--
-- Asks the LSP where the symbol under the cursor is defined, then widens that
-- location to the enclosing textobject (e.g. the whole function body) and shows
-- it in a floating preview.  Pressing the same key again jumps into the float.
local M = {}

local floating_win ---@type integer|nil

---@param buf integer
---@param query_string string
---@param lsp_range table LSP Range covering the definition
---@return integer, integer start and end line, 0-indexed inclusive
local function textobject_lines(buf, query_string, lsp_range)
  local first, last = lsp_range.start.line, lsp_range['end'].line

  -- An end character of 0 stops at the start of the line; don't show a trailing
  -- blank line for it.
  if lsp_range['end'].character == 0 and last > first then last = last - 1 end

  local ok, range = pcall(
    require('nvim-treesitter-textobjects.shared').textobject_at_point,
    query_string,
    'textobjects',
    buf,
    { lsp_range.start.line + 1, lsp_range.start.character }
  )
  -- Range6: { start_row, start_col, start_byte, end_row, end_col, end_byte }
  if ok and range then
    first = math.min(first, range[1])
    last = math.max(last, range[4])
  end
  return first, last
end

---@param query_string string textobject capture, e.g. '@function.outer'
function M.peek_definition_code(query_string)
  if floating_win and vim.api.nvim_win_is_valid(floating_win) then
    vim.api.nvim_set_current_win(floating_win)
    return
  end

  local win = vim.api.nvim_get_current_win()
  local params = function(client) return vim.lsp.util.make_position_params(win, client.offset_encoding) end

  vim.lsp.buf_request(0, 'textDocument/definition', params, function(err, result)
    if err then
      vim.notify('Peek definition: ' .. tostring(err.message or err), vim.log.levels.ERROR)
      return
    end
    if not result or vim.tbl_isempty(result) then
      vim.notify('No definition found', vim.log.levels.INFO)
      return
    end

    -- The reply is either a Location, a LocationLink, or a list of either.
    local location = vim.islist(result) and result[1] or result
    local uri = location.targetUri or location.uri
    local lsp_range = location.targetRange or location.range
    if not uri or not lsp_range then return end

    local buf = vim.uri_to_bufnr(uri)
    vim.fn.bufload(buf)

    local first, last = textobject_lines(buf, query_string, lsp_range)
    local contents = vim.api.nvim_buf_get_lines(buf, first, last + 1, false)
    if vim.tbl_isempty(contents) then return end

    local _, preview_win = vim.lsp.util.open_floating_preview(contents, vim.bo[buf].filetype, { border = 'single' })
    floating_win = preview_win
  end)
end

return M
