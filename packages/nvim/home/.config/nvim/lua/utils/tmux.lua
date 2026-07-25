-- Tmux integration utilities
-- Uses vim.system() with argv arrays (no shell interpolation → injection-safe)
local M = {}

-- Check if we're running inside tmux
function M.is_tmux() return vim.env.TMUX ~= nil end

-- Run a tmux command synchronously; returns trimmed stdout or nil on failure
local function tmux_output(args)
  local ok, proc = pcall(function() return vim.system(args, { text = true }):wait() end)
  if not ok or proc.code ~= 0 then return nil end
  local out = (proc.stdout or ''):gsub('\n$', '')
  return out
end

-- Run a tmux command synchronously; returns true on success
local function tmux_run(args)
  local ok, proc = pcall(function() return vim.system(args):wait() end)
  return ok and proc.code == 0
end

-- Get current tmux session name
function M.get_session_name()
  if not M.is_tmux() then return nil end
  local session_name = tmux_output({ 'tmux', 'display-message', '-p', '#S' })
  return (session_name and session_name ~= '') and session_name or nil
end

-- Get current tmux window name
function M.get_window_name()
  if not M.is_tmux() then return nil end
  local window_name = tmux_output({ 'tmux', 'display-message', '-p', '#W' })
  return (window_name and window_name ~= '') and window_name or nil
end

-- Set tmux window title
function M.set_window_title(title)
  if not M.is_tmux() or not title then return false end
  return tmux_run({ 'tmux', 'rename-window', title })
end

-- Get current tmux pane index
function M.get_pane_index()
  if not M.is_tmux() then return nil end
  return tonumber(tmux_output({ 'tmux', 'display-message', '-p', '#P' }) or '')
end

-- Check if current pane is zoomed
function M.is_zoomed()
  if not M.is_tmux() then return false end
  return tmux_output({ 'tmux', 'display-message', '-p', '#{window_zoomed_flag}' }) == '1'
end

-- Send keys to tmux
function M.send_keys(keys)
  if not M.is_tmux() or not keys then return false end
  return tmux_run({ 'tmux', 'send-keys', keys })
end

-- Create a new tmux window with specific command
function M.new_window(name, command)
  if not M.is_tmux() then return false end

  local args = { 'tmux', 'new-window' }
  if name and name ~= '' then
    table.insert(args, '-n')
    table.insert(args, name)
  end
  if command and command ~= '' then table.insert(args, command) end

  return tmux_run(args)
end

-- Split current pane
function M.split_pane(direction, command)
  if not M.is_tmux() then return false end

  local args = { 'tmux', 'split-window', direction == 'horizontal' and '-h' or '-v' }
  if command and command ~= '' then table.insert(args, command) end

  return tmux_run(args)
end

-- Get list of nvim instances in current tmux session
function M.get_nvim_panes()
  if not M.is_tmux() then return {} end

  local output = tmux_output({ 'tmux', 'list-panes', '-s', '-F', '#{pane_id} #{pane_current_command}' })
  local panes = {}

  if output then
    for line in output:gmatch('[^\r\n]+') do
      local pane_id, command = line:match('(%S+) (.+)')
      if command and command:match('n?vim') then
        table.insert(panes, {
          id = pane_id,
          command = command,
        })
      end
    end
  end

  return panes
end

-- Switch to specific tmux pane
function M.switch_to_pane(pane_id)
  if not M.is_tmux() or not pane_id then return false end
  return tmux_run({ 'tmux', 'select-pane', '-t', pane_id })
end

-- Refresh tmux client
function M.refresh_client()
  if not M.is_tmux() then return false end
  return tmux_run({ 'tmux', 'refresh-client', '-S' })
end

-- Get project-specific session name
function M.get_project_session_name()
  local cwd = vim.fn.getcwd()
  local project_name = vim.fn.fnamemodify(cwd, ':t')

  -- If in a git repo, use the repo name
  if vim.fn.isdirectory('.git') == 1 then
    local git_root = tmux_output({ 'git', 'rev-parse', '--show-toplevel' })
    if git_root and git_root ~= '' then project_name = vim.fn.fnamemodify(git_root, ':t') end
  end

  return project_name
end

-- Setup project-based tmux workflow
function M.setup_project_workflow()
  if not M.is_tmux() then return end

  local project_name = M.get_project_session_name()
  local current_session = M.get_session_name()

  -- If not in a project session, create or switch to one
  if current_session ~= project_name then
    if tmux_run({ 'tmux', 'has-session', '-t', project_name }) then
      -- Session exists, switch to it
      tmux_run({ 'tmux', 'switch-client', '-t', project_name })
    else
      -- Create new session
      tmux_run({ 'tmux', 'new-session', '-d', '-s', project_name })
      tmux_run({ 'tmux', 'switch-client', '-t', project_name })
    end
  end
end

-- Enhanced focus detection for multiple nvim instances
function M.handle_focus_gained()
  if not M.is_tmux() then return end

  -- Don't run in command-line window
  if vim.fn.getcmdwintype() ~= '' then return end

  -- Refresh tmux client (async: nothing depends on the result)
  pcall(function() vim.system({ 'tmux', 'refresh-client', '-S' }) end)

  -- Check if this is the active pane (async to keep FocusGained snappy)
  pcall(function()
    vim.system({ 'tmux', 'display-message', '-p', '#{pane_active}' }, { text = true }, function(proc)
      if proc.code ~= 0 then return end
      local is_active = (proc.stdout or ''):gsub('\n$', '')
      if is_active ~= '1' then return end
      vim.schedule(function()
        -- This pane is active, check for file changes safely
        if vim.fn.getcmdwintype() == '' then pcall(vim.cmd, 'checktime') end
      end)
    end)
  end)
end

-- Setup tmux integration
function M.setup()
  if not M.is_tmux() then return end

  -- Create autocmds for tmux integration
  local group = vim.api.nvim_create_augroup('tmux-integration', {
    clear = true,
  })

  -- Handle focus events (FocusGained only — running this on every BufEnter
  -- spammed tmux with refresh-client calls)
  vim.api.nvim_create_autocmd('FocusGained', {
    group = group,
    callback = M.handle_focus_gained,
  })

  -- Setup project workflow on VimEnter
  vim.api.nvim_create_autocmd('VimEnter', {
    group = group,
    once = true,
    callback = M.setup_project_workflow,
  })

  -- Note: Tmux user commands are now defined in commands.lua
end

return M
