-- Shared UI palette.
-- These are the exact hex values that were previously hard-coded across
-- lualine/noice/notify/nvim-cmp (visuals unchanged). Despite older comments
-- calling them "Tokyo Night", most are Catppuccin Mocha values, with a few
-- genuine Tokyo Night accents kept under the tn_ prefix.
local M = {
  -- Backgrounds / surfaces (Catppuccin Mocha)
  base = '#1e1e2e', -- base background
  surface0 = '#313244', -- panel background
  surface1 = '#45475a', -- lighter surface
  sel_bg = '#2a2e3f', -- popup selection background

  -- Foregrounds (Catppuccin Mocha)
  text = '#cdd6f4',
  subtext = '#bac2de',
  overlay = '#6c7086',

  -- Accents (Catppuccin Mocha)
  blue = '#89b4fa',
  green = '#a6e3a1',
  yellow = '#f9e2af',
  red = '#f38ba8',
  mauve = '#cba6f7',

  -- Tokyo Night accents
  tn_bg_dark = '#16161e',
  tn_blue = '#7aa2f7',
  tn_border = '#414868',
}

return M
