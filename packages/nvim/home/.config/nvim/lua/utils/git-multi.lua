local M = {}

M.opts = {
  depth = 5,
}

M.setup = function(user_opts) M.opts = vim.tbl_deep_extend('force', M.opts, user_opts or {}) end

M.git_status_multi = function(opts)
  local fzf = require('fzf-lua')
  fzf.git_status({
    prompt = 'Git Status> ',
    fzf_opts = {
      ['--bind'] = 'ctrl-y:execute-silent(echo {+} | clipboard-copy)',
    },
    actions = {
      ['default'] = require('fzf-lua.actions').file_edit,
      ['ctrl-d'] = function(selected)
        if not selected or #selected == 0 then return end
        local file = selected[1]:gsub('^%s*[MADRCU?!]%s*[MADRCU?!]?%s+', ''):gsub('^%s+', '')
        vim.cmd('DiffviewOpen -- ' .. vim.fn.fnameescape(file))
      end,
    },
  })
end

return M
