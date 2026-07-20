-- Buffer-local setup for .http / .rest files. Prefix: <leader>R (see which-key).
-- Two independent pieces: bruce's void toggle + write-highlight (always on), and
-- the kulala.nvim REST-client keymaps (only if the plugin loads).

-- void toggle + "WRITES TO DB" highlight — independent of kulala.
require('utils.http_void').attach(0)

local function map(lhs, fn, desc)
  if type(fn) ~= 'function' then
    return -- stay resilient across kulala versions: skip a missing action
  end
  vim.keymap.set('n', lhs, fn, { buffer = 0, silent = true, desc = desc })
end

map('<leader>Rv', require('utils.http_void').toggle, 'Toggle void (dry-run / WRITE)')

-- Requiring 'kulala' here force-loads the (lazy) plugin on the first .http buffer.
local ok, kulala = pcall(require, 'kulala')
if ok then
  map('<leader>Rs', kulala.run, 'Send request under cursor')
  map('<leader>Ra', kulala.run_all, 'Send all requests in file')
  map('<leader>Rr', kulala.replay, 'Replay last request')
  map('<leader>Re', kulala.set_selected_env, 'Select environment (local / staging / local-root)')
  map('<leader>Rn', kulala.jump_next, 'Jump to next request')
  map('<leader>Rp', kulala.jump_prev, 'Jump to previous request')
  map('<leader>Rt', kulala.toggle_view, 'Toggle body / headers view')
  map('<leader>Ri', kulala.inspect, 'Inspect parsed request')
  map('<leader>RS', kulala.show_stats, 'Show last response stats')
  map('<leader>Rc', kulala.copy, 'Copy request as cURL')
  map('<leader>RC', kulala.from_curl, 'Paste cURL as request')
  map('<leader>Rb', kulala.scratchpad, 'Open scratchpad')
  map('<leader>Rx', kulala.close, 'Close kulala window')
end

local wk_ok, wk = pcall(require, 'which-key')
if wk_ok then wk.add({ { '<leader>R', group = 'REST (kulala)', buffer = 0 } }) end
