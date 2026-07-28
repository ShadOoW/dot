-- Incremental selection, which the nvim-treesitter rewrite ('main') dropped.
--
-- Keeps a per-buffer stack of nodes: growing pushes the next enclosing node (or
-- the next enclosing @local.scope), shrinking pops back to the previous one.
-- Nodes are only valid between edits, which is exactly how long a selection
-- session lasts -- any stale node resets the stack.
local M = {}

---@type table<integer, TSNode[]>
local stack = {}

---@param node TSNode
---@return integer, integer, integer, integer
local function range_of(node) return node:range() end

--- Visual mode is inclusive but treesitter end columns are exclusive.
---@param node TSNode
local function select_node(node)
  local srow, scol, erow, ecol = range_of(node)

  -- An end column of 0 stops at the *start* of `erow`, so step back onto the
  -- last character of the preceding line instead of selecting a leading column.
  if ecol == 0 and erow > srow then
    erow = erow - 1
    ecol = #(vim.api.nvim_buf_get_lines(0, erow, erow + 1, false)[1] or '')
  end
  ecol = math.max(ecol - 1, 0)

  if vim.fn.mode():match('[vV\22]') then vim.cmd('normal! ' .. vim.keycode('<Esc>')) end
  vim.api.nvim_win_set_cursor(0, { srow + 1, scol })
  vim.cmd('normal! v')
  vim.api.nvim_win_set_cursor(0, { erow + 1, ecol })
end

---@param buf integer
---@return TSNode|nil
local function top(buf)
  local nodes = stack[buf]
  if not nodes or #nodes == 0 then return nil end

  local node = nodes[#nodes]
  -- A node from a since-reparsed tree throws on access; drop the session.
  if not pcall(range_of, node) then
    stack[buf] = nil
    return nil
  end
  return node
end

---@param buf integer
---@param node TSNode
local function push(buf, node)
  stack[buf] = stack[buf] or {}
  table.insert(stack[buf], node)
  select_node(node)
end

--- All @local.scope nodes in the buffer, innermost last.
---@param buf integer
---@return TSNode[]
local function scopes(buf)
  local ok, parser = pcall(vim.treesitter.get_parser, buf, nil, { error = false })
  if not ok or not parser then return {} end

  local query = vim.treesitter.query.get(parser:lang(), 'locals')
  local trees = parser:parse()
  local tree = trees and trees[1]
  if not query or not tree then return {} end

  local found = {}
  for id, node in query:iter_captures(tree:root(), buf, 0, -1) do
    if query.captures[id] == 'local.scope' then found[#found + 1] = node end
  end
  return found
end

---@param outer TSNode
---@param inner TSNode
---@return boolean
local function contains_strictly(outer, inner)
  local osr, osc, oer, oec = range_of(outer)
  local isr, isc, ier, iec = range_of(inner)
  local starts_before = osr < isr or (osr == isr and osc <= isc)
  local ends_after = oer > ier or (oer == ier and oec >= iec)
  local identical = osr == isr and osc == isc and oer == ier and oec == iec
  return starts_before and ends_after and not identical
end

function M.init_selection()
  local buf = vim.api.nvim_get_current_buf()
  local node = vim.treesitter.get_node({ bufnr = buf })
  if not node then return end

  stack[buf] = {}
  push(buf, node)
end

function M.node_incremental()
  local buf = vim.api.nvim_get_current_buf()
  local node = top(buf)
  if not node then return M.init_selection() end

  -- Skip ancestors that span exactly the same text, so one press always grows
  -- the selection visibly.
  local parent = node:parent()
  while parent do
    if contains_strictly(parent, node) then return push(buf, parent) end
    parent = parent:parent()
  end
  select_node(node)
end

function M.scope_incremental()
  local buf = vim.api.nvim_get_current_buf()
  local node = top(buf)
  if not node then
    M.init_selection()
    node = top(buf)
    if not node then return end
  end

  local best ---@type TSNode|nil
  for _, scope in ipairs(scopes(buf)) do
    if contains_strictly(scope, node) and (not best or contains_strictly(best, scope)) then best = scope end
  end
  if best then return push(buf, best) end

  -- No enclosing scope left; fall back to growing by one node.
  M.node_incremental()
end

function M.node_decremental()
  local buf = vim.api.nvim_get_current_buf()
  local nodes = stack[buf]
  if not nodes or #nodes < 2 then return end

  table.remove(nodes)
  local node = top(buf)
  if node then select_node(node) end
end

return M
