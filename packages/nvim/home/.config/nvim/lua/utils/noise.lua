-- Diagnostics and inlay hints, on demand
--
-- Nothing about a diagnostic is drawn over the code.  A sign in the gutter and
-- an underline say *where*; `[d`/`]d` and `[e`/`]e` go there; `<leader>cd`
-- opens a focused float that says what it is and closes with `q`.  Three
-- channels, each doing one job, none of them occupying a screen row you were
-- using to read code.
--
-- Inlay hints are the one thing still rendered inline, because a type you did
-- not write is information the code cannot give you.  They come in levels —
-- `<leader>ch` cycles types → full → off.

local notify = require('utils.notify')

local M = {}

-- ═══════════════════════════════════════════════════════════════════════════
-- Diagnostic float
-- ═══════════════════════════════════════════════════════════════════════════

--- Diagnostics carrying the compiler's own verdict.  When rustc has already
--- spoken about a position, rust-analyzer's in-process guess about the same
--- position adds wording, not information.
local AUTHORITATIVE = { rustc = true, clippy = true }

---@param diagnostic vim.Diagnostic
local function is_authoritative(diagnostic)
  local source = diagnostic.source and diagnostic.source:lower() or ''
  for name in pairs(AUTHORITATIVE) do
    if source:find(name, 1, true) then return true end
  end
  return false
end

--- Stable identity for a diagnostic: `format` is handed copies, so table
--- identity cannot be used to match one against the buffer's own list.
---@param d vim.Diagnostic
local function diag_key(d)
  return table.concat({ d.lnum, d.col, d.severity, tostring(d.source), tostring(d.code), d.message }, '\0')
end

--- One extra argument in a method call produces, on the same line: rustc's
--- E0061 at the receiver, rust-analyzer's own E0107 three columns over, and a
--- second copy of the name-resolution error from each of them.  Six entries for
--- one typo, and the float is the only place they are read now, so it is the
--- float that has to collapse them.
---
---  * Line level — once `cargo check`/clippy has reported at a severity on a
---    line, rust-analyzer's in-process guesses at that severity are dropped.
---    Their value is arriving first, not saying something additional; on a line
---    the compiler has already judged they are just a second opinion.
---  * Position level — among what survives, one entry per starting column,
---    using the longest message, reliably the most specific of the set.
---
--- Severity is part of both rules, so a warning sharing a spot with an error is
--- still listed, and the diagnostics panel remains the unfiltered view.
---
--- Returns two sets keyed by `diag_key`: what was judged, and what to show.
--- Both are derived from the diagnostics covering `lnum`, which is the same set
--- `open_float` renders — that is what makes the filter unable to empty a
--- float, since each (severity, column) group always keeps a member.
---@return table<string, true> considered, table<string, true> keep
local function triage(bufnr, lnum)
  -- `get` matches a line against a diagnostic's whole range, not just its start
  -- (`lnum >= d.lnum and lnum <= d.end_lnum`), exactly as open_float does for
  -- scope='line'.
  local candidates = vim.diagnostic.get(bufnr, { lnum = lnum })
  local considered, keep = {}, {}

  local settled = {} ---@type table<integer, true> severity → the compiler has spoken here
  for _, d in ipairs(candidates) do
    considered[diag_key(d)] = true
    if is_authoritative(d) then settled[d.severity] = true end
  end

  local best = {} ---@type table<string, vim.Diagnostic> (severity, column) → what to show for it
  for _, d in ipairs(candidates) do
    if is_authoritative(d) or not settled[d.severity] then
      local slot = d.severity .. '\0' .. d.col
      if not best[slot] or #d.message > #best[slot].message then best[slot] = d end
    end
  end
  for _, d in pairs(best) do
    keep[diag_key(d)] = true
  end

  return considered, keep
end

---@param d vim.Diagnostic
---@return string?
local function format_float(d)
  -- open_float places itself at the cursor, so the cursor line is the line
  -- whose diagnostics it is about to render.
  local lnum = vim.api.nvim_win_get_cursor(0)[1] - 1
  local considered, keep = triage(d.bufnr or 0, lnum)
  local key = diag_key(d)

  -- A diagnostic outside that set was never ours to judge — a `scope = 'buffer'`
  -- float, say.  Passing it through means this filter can only ever thin a
  -- float it populated, never blank one out.
  if not considered[key] then return d.message end
  return keep[key] and d.message or nil
end

local float_win

--- Read the diagnostics on this line, in a window you are standing in: `q`
--- closes it, `<C-u>`/`<C-d>` scroll a type error too long to fit, and pressing
--- the key again from inside dismisses it.
---
--- `vim.diagnostic.open_float` cannot be asked for that directly.  It sets
--- `focus_id` to the scope, and `vim.lsp.util.open_floating_preview` treats an
--- already-open float with a matching id as something to *focus* rather than
--- rebuild — so a second press would jump into a window still showing whatever
--- diagnostics it was born with.  Build it unfocused, which takes the rebuild
--- path, then step into it.
function M.diagnostic_float()
  if float_win and vim.api.nvim_win_is_valid(float_win) and vim.api.nvim_get_current_win() == float_win then
    vim.api.nvim_win_close(float_win, true)
    float_win = nil
    return
  end

  local lnum = vim.api.nvim_win_get_cursor(0)[1] - 1
  if #vim.diagnostic.get(0, { lnum = lnum }) == 0 then
    notify.info('Diagnostics', 'Nothing on this line')
    return
  end

  local _, win = vim.diagnostic.open_float({ scope = 'line', focus = false })
  float_win = win
  if win and vim.api.nvim_win_is_valid(win) then vim.api.nvim_set_current_win(win) end
end

-- ═══════════════════════════════════════════════════════════════════════════
-- Inlay hints
-- ═══════════════════════════════════════════════════════════════════════════

--- Hints that pay for their screen space while learning the language: what a
--- binding inferred to, what a closure returns.  Redundant renderings are
--- hidden — `let x: Foo = Foo::new()` already states its type twice.
local RA_HINTS_BASE = {
  -- Plain usize, not a table: rust-analyzer rejects the whole inlayHints block
  -- with "invalid type: map, expected usize" if this is given a shape.
  maxLength = 20,
  renderColons = true,
  closureReturnTypeHints = { enable = 'with_block' },
  typeHints = { enable = true, hideClosureInitialization = true, hideNamedConstructor = true },
}

--- 'types' hides the hints that cost the most per unit of insight: parameter
--- names and chaining types turn a builder chain into a wall of grey, and
--- closing-brace hints repeat what indentation already says.  They are all
--- still there at 'full'.
local RA_HINTS = {
  types = vim.tbl_deep_extend('force', RA_HINTS_BASE, {
    bindingModeHints = { enable = false },
    chainingHints = { enable = false },
    closingBraceHints = { enable = false },
    lifetimeElisionHints = { enable = 'never' },
    parameterHints = { enable = false },
  }),
  full = vim.tbl_deep_extend('force', RA_HINTS_BASE, {
    bindingModeHints = { enable = true },
    chainingHints = { enable = true },
    closingBraceHints = { enable = true, minLines = 25 },
    lifetimeElisionHints = { enable = 'skip_trivial', useParameterNames = true },
    parameterHints = { enable = true },
  }),
}

local HINT_LEVELS = { 'types', 'full', 'off' }

M.hint_level = 'types'

--- Settings block for lsp/servers/rust_analyzer.lua, so the server starts at
--- the current level instead of computing hints nobody asked for.
function M.ra_inlay_hints() return RA_HINTS[M.hint_level] or RA_HINTS.types end

--- rust-analyzer recomputes hints only when its configuration changes, so
--- switching levels means pushing settings and letting the server re-send.
---@param client vim.lsp.Client? limit the push to one client (used on attach)
function M.apply_hints(client)
  if M.hint_level ~= 'off' then
    local clients = client and { client } or vim.lsp.get_clients({ name = 'rust_analyzer' })
    for _, c in ipairs(clients) do
      if c.name == 'rust_analyzer' then
        c.settings = vim.tbl_deep_extend('force', c.settings or {}, {
          ['rust-analyzer'] = { inlayHints = M.ra_inlay_hints() },
        })
        c:notify('workspace/didChangeConfiguration', { settings = c.settings })
      end
    end
  end
  vim.lsp.inlay_hint.enable(M.hint_level ~= 'off')
end

function M.cycle_hints()
  local idx = 1
  for i, level in ipairs(HINT_LEVELS) do
    if level == M.hint_level then idx = i end
  end
  M.hint_level = HINT_LEVELS[idx % #HINT_LEVELS + 1]
  M.apply_hints()
  notify.info(
    'Inlay hints',
    ({ types = 'inferred types only', full = 'types, params, chains', off = 'hidden' })[M.hint_level]
  )
end

-- ═══════════════════════════════════════════════════════════════════════════
-- Setup
-- ═══════════════════════════════════════════════════════════════════════════

function M.setup()
  vim.diagnostic.config({
    severity_sort = true,
    update_in_insert = false,
    -- Nothing inline.  Virtual text clips the message; virtual lines push the
    -- file down by however many diagnostics the line collected.  Neither is
    -- needed once the gutter says where and `<leader>cd` says what.
    virtual_text = false,
    virtual_lines = false,
    -- The underline is what survives of "which part of this line" — a sign is
    -- accurate to the row only, so warnings get one too, not just errors.
    underline = {
      severity = { min = vim.diagnostic.severity.WARN },
    },
    signs = vim.g.have_nerd_font and {
      text = {
        [vim.diagnostic.severity.ERROR] = '󰅚 ',
        [vim.diagnostic.severity.WARN] = '󰀪 ',
        [vim.diagnostic.severity.INFO] = '󰋽 ',
        [vim.diagnostic.severity.HINT] = '󰌶 ',
      },
    } or {},
    float = {
      border = 'rounded',
      source = 'if_many',
      -- rust-analyzer's "full type: (ScheduleConfigTupleMarker, {unknown}, …)"
      -- is one enormous line; cap the box and let it wrap instead of running
      -- off the side of the screen.  No header — the border says what it is.
      header = '',
      max_width = 80,
      max_height = 20,
      focus = false,
      -- Number the entries only when there is more than one; the default
      -- numbers unconditionally, so a lone error is announced as "1.".
      prefix = function(_, i, total) return total > 1 and string.format('%d. ', i) or '' end,
      format = format_float,
    },
  })
end

return M
