-- agent-watch.lua: keep buffers, gitsigns and diff views live while an
-- external agent (Claude Code) edits the working tree.
--
-- Neovim only re-reads changed files on FocusGained/CursorHold, so while you
-- watch an agent work from another kitty window everything in nvim goes
-- stale. This module polls `git status --porcelain` asynchronously and, when
-- the tree changes: reloads unmodified buffers, refreshes gitsigns, refreshes
-- any open Diffview, and fires a `User AgentFsChanged` autocmd for other
-- consumers (codediff explorer, statusline, ...).
--
-- It also watches <git-dir>/claude/turn-done — written by the Claude Code
-- Stop hook — and announces "turn finished, review with <leader>rc".

local M = {}

M.opts = {
  interval_ms = 1500,
  notify_on_turn_done = true,
}

local state = {
  timer = nil,
  root = nil, ---@type string? git toplevel of nvim's cwd
  git_dir = nil, ---@type string? absolute git dir (worktree-safe)
  last_status = nil, ---@type string? previous `git status --porcelain` output
  last_turn_done = nil, ---@type integer? mtime of the Stop-hook signal file
  busy = false,
}

local function on_tree_changed()
  vim.cmd('silent! checktime')
  pcall(function() require('gitsigns').refresh() end)
  if package.loaded['diffview'] and require('diffview.lib').get_current_view() then
    pcall(vim.cmd, 'DiffviewRefresh')
  end
  vim.api.nvim_exec_autocmds('User', { pattern = 'AgentFsChanged' })
end

local function check_turn_done()
  if not state.git_dir then return end
  local stat = vim.uv.fs_stat(state.git_dir .. '/claude/turn-done')
  if not stat then return end
  local mtime = stat.mtime.sec
  local prev = state.last_turn_done
  state.last_turn_done = mtime
  -- prev == nil means first sighting since nvim started: stay quiet, the
  -- signal may be from a turn that ended before this session existed.
  if prev == nil or mtime <= prev then return end
  vim.api.nvim_exec_autocmds('User', { pattern = 'AgentTurnDone' })
  if M.opts.notify_on_turn_done then
    vim.notify('Claude finished a turn — <leader>rc to review', vim.log.levels.INFO, { title = 'Review' })
  end
end

local function poll()
  if state.busy or not state.root then return end
  state.busy = true
  vim.system(
    { 'git', '-C', state.root, 'status', '--porcelain' },
    { text = true },
    vim.schedule_wrap(function(res)
      state.busy = false
      if res.code ~= 0 then return end
      if state.last_status ~= nil and res.stdout ~= state.last_status then on_tree_changed() end
      state.last_status = res.stdout
      check_turn_done()
    end)
  )
end

--- Resolve git toplevel + git dir for the current cwd (async, worktree-safe).
local function detect_root()
  vim.system(
    { 'git', 'rev-parse', '--show-toplevel', '--absolute-git-dir' },
    { text = true },
    vim.schedule_wrap(function(res)
      if res.code ~= 0 then
        state.root, state.git_dir = nil, nil
        return
      end
      local lines = vim.split(res.stdout, '\n', { trimempty = true })
      state.root, state.git_dir = lines[1], lines[2]
      state.last_status, state.last_turn_done = nil, nil
    end)
  )
end

M.setup = function(user_opts)
  M.opts = vim.tbl_deep_extend('force', M.opts, user_opts or {})
  detect_root()

  vim.api.nvim_create_autocmd('DirChanged', {
    group = vim.api.nvim_create_augroup('agent_watch', { clear = true }),
    callback = detect_root,
  })

  state.timer = vim.uv.new_timer()
  state.timer:start(M.opts.interval_ms, M.opts.interval_ms, vim.schedule_wrap(poll))
end

M.stop = function()
  if state.timer then
    state.timer:stop()
    state.timer:close()
    state.timer = nil
  end
end

return M
