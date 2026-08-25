-- Hammerspoon — clipboard bridge to the Linux desktop (saykuk).
--
-- WHAT THIS GIVES YOU
-- Anything copied on the Mac is pushed automatically into the desktop's cliphist
-- history, so it is there under `mod+c` with no keystroke. The heavy lifting is in
-- clipboard-sync.sh; this file only decides WHEN to run it.
--
-- WHY A POLL AND NOT AN EVENT: macOS has no clipboard-change notification. Every Mac
-- clipboard manager polls NSPasteboard's changeCount, which is a cheap integer read and
-- needs no permissions at all — no Accessibility, no TCC prompt. (The hotkey at the
-- bottom is the only thing here that needs Accessibility.)
--
-- WHY WE DO NOT USE MOONLIGHT'S OWN Ctrl+Alt+Shift+V: it is a real shortcut, but it
-- sends a GameStream UTF-8 text event and Sunshine has no clipboard sync — it *types*
-- the text using the IBus "Ctrl+Shift+U, hex, Enter" convention. The desktop runs Sway
-- with no input-method framework, so nothing interprets that and the paste vanishes.

hs.allowAppleScript(true)

local SYNC = os.getenv('HOME') .. '/.hammerspoon/clipboard-sync.sh'
local POLL_SECONDS = 1 -- changeCount is a cheap integer read
local BACKLOG_SECONDS = 30 -- drain the spool when the desktop comes back
local FAILURE_ALERT_AT = 10 -- one warning, not a stream of them

local lastChangeCount = hs.pasteboard.changeCount()
local consecutiveFailures = 0

-- Fire-and-forget. Failures are normal and self-healing: the spool keeps the clip and a
-- later flush sends it. But a sync that is permanently broken must not be silent, so one
-- alert fires at the threshold and then stays quiet until it recovers.
local function runSync(mode)
  hs.task
    .new('/bin/sh', function(rc)
      if rc == 0 then
        consecutiveFailures = 0
      else
        consecutiveFailures = consecutiveFailures + 1
        if consecutiveFailures == FAILURE_ALERT_AT then
          hs.alert.show('clipboard sync: ' .. FAILURE_ALERT_AT .. ' pushes failed — desktop unreachable?')
        end
      end
    end, { SYNC, mode })
    :start()
end

-- New copy -> capture it and try to send everything queued.
hs.timer.doEvery(POLL_SECONDS, function()
  local count = hs.pasteboard.changeCount()
  if count ~= lastChangeCount then
    lastChangeCount = count
    runSync('sync')
  end
end)

-- Nothing new, but there may be a backlog from while the desktop was away.
hs.timer.doEvery(BACKLOG_SECONDS, function() runSync('flush') end)

-- Manual promote: put the Mac clipboard into the desktop's LIVE selection, so it can be
-- pasted with Ctrl+V right now instead of picked out of history. The automatic sync above
-- deliberately does not touch the live selection — it would stomp whatever you are
-- copying on Linux.
hs.hotkey.bind({ 'ctrl', 'alt', 'shift' }, 'v', function()
  if (hs.pasteboard.getContents() or '') == '' then
    hs.alert.show('Mac clipboard is empty')
    return
  end
  local cmd = '/usr/bin/pbpaste | /usr/bin/ssh -o BatchMode=yes -o ConnectTimeout=8 desktop '
    .. '\'XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-1 /usr/sbin/wl-copy >/dev/null 2>&1\''
  hs.task
    .new(
      '/bin/sh',
      function(rc) hs.alert.show(rc == 0 and '→ desktop clipboard' or 'promote failed (rc=' .. tostring(rc) .. ')') end,
      { '-c', cmd }
    )
    :start()
end)

hs.alert.show('Hammerspoon: clipboard sync active')
