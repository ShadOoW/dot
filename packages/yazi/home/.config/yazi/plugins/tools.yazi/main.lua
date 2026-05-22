local TOOLS = {
  { on = 'c', desc = 'Compress (ouch)' },
  { on = 'e', desc = 'Extract (ouch)' },
  { on = 'g', desc = 'Git log (tig)' },
  { on = 'm', desc = 'chmod' },
  { on = 'r', desc = 'Restore from trash' },
  { on = 'd', desc = 'Diff' },
}

return {
  entry = function()
    local idx = ya.which({ cands = TOOLS })
    if not idx then return end
    local key = TOOLS[idx].on

    if key == 'c' then
      ya.emit('plugin', { 'ouch' })
    elseif key == 'e' then
      ya.emit('shell', { 'ouch d "$@"', block = true })
    elseif key == 'g' then
      ya.emit('shell', { 'tig', block = true })
    elseif key == 'm' then
      ya.emit('plugin', { 'chmod' })
    elseif key == 'r' then
      ya.emit('plugin', { 'restore' })
    elseif key == 'd' then
      ya.emit('plugin', { 'diff' })
    end
  end,
}
