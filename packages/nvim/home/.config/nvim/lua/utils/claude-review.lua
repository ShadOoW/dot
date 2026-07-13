-- claude-review.lua: review what Claude Code changed and talk back to it.
--
-- Baselines are refs written by Claude Code hooks (see packages/claude
-- home/.local/bin/claude-turn-snapshot):
--   refs/claude/turn-base    — working-tree snapshot at last prompt submit
--   refs/claude/session-base — snapshot at session start
--
-- Review surfaces:
--   review_turn()/review_session() — codediff explorer, working tree vs ref
--   toggle_inline()                — gitsigns base switched to the turn ref,
--                                    so gutter hunks *are* Claude's changes
--                                    and <leader>gr rejects one against it
--   send()/send_visual()           — pipe text into the repo's running
--                                    Claude kitty window via `dot tools
--                                    claude-send`

local notify = require('utils.notify')

local M = {}

local function rev(ref)
  local res = vim.system({ 'git', 'rev-parse', '--verify', '--quiet', ref }, { text = true }):wait()
  if res.code ~= 0 then return nil end
  return vim.trim(res.stdout)
end

M.turn_base = function() return rev('refs/claude/turn-base') end
M.session_base = function() return rev('refs/claude/session-base') end

local function open_codediff(base, label)
  if base then
    vim.cmd('CodeDiff ' .. base)
  else
    notify.warn('Review', 'No Claude ' .. label .. ' baseline found — showing working tree vs HEAD')
    vim.cmd('CodeDiff')
  end
end

M.review_turn = function() open_codediff(M.turn_base(), 'turn') end
M.review_session = function() open_codediff(M.session_base(), 'session') end

-- ── Inline review: point gitsigns at the turn baseline ─────────────────────
local inline_active = false

M.toggle_inline = function()
  local gs = require('gitsigns')
  if inline_active then
    gs.reset_base(true)
    gs.toggle_word_diff(false)
    inline_active = false
    notify.info('Review', 'Inline turn review OFF — gitsigns back to index')
    return
  end
  local base = M.turn_base()
  if not base then
    notify.warn('Review', 'No Claude turn baseline found')
    return
  end
  gs.change_base(base, true)
  gs.toggle_word_diff(true)
  inline_active = true
  notify.info('Review', 'Hunks = Claude turn · <leader>gj/gk walk · <leader>gp peek · <leader>gr reject')
end

M.inline_active = function() return inline_active end

-- ── Dispatch: send text into the repo's Claude Code kitty window ───────────
local function dispatch(text)
  if not text or text == '' then
    notify.warn('Review', 'Nothing to send')
    return
  end
  vim.system(
    { 'dot', 'tools', 'claude-send' },
    { stdin = text, text = true },
    vim.schedule_wrap(function(res)
      if res.code == 0 then
        notify.success('Review', 'Sent to Claude (' .. #text .. ' chars)')
      else
        notify.error('Review', vim.trim((res.stderr or '') .. (res.stdout or '')))
      end
    end)
  )
end

--- Send the clipboard (review.nvim copies its export there on quit/`C`).
M.send = function() dispatch(vim.fn.getreg('+')) end

--- Send the current visual selection.
M.send_visual = function()
  local ok, region = pcall(vim.fn.getregion, vim.fn.getpos('v'), vim.fn.getpos('.'), { type = vim.fn.mode() })
  if not ok then
    notify.warn('Review', 'Could not read selection')
    return
  end
  vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes('<Esc>', true, false, true), 'n', false)
  dispatch(table.concat(region, '\n'))
end

return M
