local notify = require('utils.notify')

return {
  'folke/tokyonight.nvim',
  priority = 1000, -- Load before other start plugins
  config = function()
    require('tokyonight').setup({
      style = 'night', -- Explicitly set to night variant
      light_style = 'day', -- Fallback for light mode
      -- transparent was defeated by on_highlights forcing hl.Normal bg below;
      -- keep the effective (opaque) look explicit.
      transparent = false,
      terminal_colors = true, -- Configure terminal colors
      styles = {
        comments = {
          italic = false,
        }, -- Disable italics in comments
        keywords = {
          italic = false,
        }, -- Disable italics in keywords
        functions = {},
        variables = {},
        sidebars = 'dark', -- Solid sidebars
        floats = 'dark', -- Solid floating windows
      },
      sidebars = { 'qf', 'help', 'vista_kind', 'terminal', 'packer' },
      day_brightness = 0.3, -- Adjusts brightness of day style
      hide_inactive_statusline = false, -- Don't hide statusline on inactive windows
      dim_inactive = false, -- Don't dim inactive windows
      lualine_bold = false, -- Don't bold lualine section headers

      -- Override specific highlight groups for solid backgrounds
      on_highlights = function(hl, c)
        hl.Normal = {
          bg = c.bg,
          fg = c.fg,
        }
        hl.NormalNC = {
          fg = c.fg,
        }
        hl.NormalFloat = {
          bg = c.bg,
          fg = c.fg,
        }
        hl.FloatBorder = {
          bg = c.bg_dark,
          fg = c.border_highlight,
        }
        hl.SignColumn = {
          fg = c.fg_gutter,
        }
        hl.LineNr = {
          fg = c.fg_gutter,
        }
        hl.CursorLineNr = {
          fg = c.orange,
        }
        hl.StatusLine = {
          fg = c.fg_sidebar,
        }
        hl.StatusLineNC = {
          fg = c.fg_gutter,
        }
        hl.WinBar = {
          fg = c.fg_sidebar,
        }
        hl.WinBarNC = {
          fg = c.fg_gutter,
        }

        hl.EndOfBuffer = {
          bg = c.bg,
          fg = c.bg,
        }
        hl.NonText = {
          bg = c.bg,
          fg = c.bg,
        }
        hl.VertSplit = {
          fg = c.border_highlight,
        }
        hl.WinSeparator = {
          fg = c.border_highlight,
        }

        hl.TabLine = {
          fg = c.fg_gutter,
        }
        hl.TabLineFill = {}
        hl.TabLineSel = {
          fg = c.fg,
        }

        hl.FoldColumn = {
          fg = c.fg_gutter,
        }
        hl.Folded = {
          fg = c.comment,
        }

        hl.CursorLine = {
          bg = c.bg_visual,
        }
        hl.CursorColumn = {
          bg = c.bg_visual,
        }

        -- Enhanced Visual selection highlighting
        hl.Visual = {
          bg = '#0ea5e9', -- Bright cyan-blue background for maximum visibility
          fg = '#1a1b26', -- Dark foreground for excellent contrast
          bold = true, -- Add bold styling for extra emphasis
        }

        -- Make VisualNOS consistent with Visual for better UX
        hl.VisualNOS = {
          bg = '#0ea5e9', -- Same as Visual for consistency
          fg = '#1a1b26', -- Dark foreground for excellent contrast
          bold = true, -- Add bold styling for extra emphasis
        }

        -- Fix search highlighting
        hl.Search = {
          bg = c.bg_search,
          fg = c.fg,
        }
        hl.IncSearch = {
          bg = c.orange,
          fg = c.bg,
        }

        hl.Pmenu = {
          bg = c.bg_popup,
          fg = c.fg,
        }
        hl.PmenuSel = {
          bg = c.bg_visual,
          fg = c.fg,
        }
        hl.PmenuSbar = {
          bg = c.bg_popup,
        }
        hl.PmenuThumb = {
          bg = c.fg_gutter,
        }

        hl.DiagnosticSignError = {
          bg = c.bg_dark,
          fg = '#f7768e', -- Tokyo Night error red
        }
        hl.DiagnosticSignWarn = {
          bg = c.bg_dark,
          fg = '#e0af68', -- Bright yellow for better visibility
        }
        hl.DiagnosticSignInfo = {
          bg = c.bg_dark,
          fg = '#0db9d7', -- Tokyo Night info blue
        }
        hl.DiagnosticSignHint = {
          bg = c.bg_dark,
          fg = '#1abc9c', -- Tokyo Night hint teal
        }

        hl.DiagnosticVirtualTextError = {
          bg = c.bg_dark,
          fg = c.error,
          italic = true,
        }
        hl.DiagnosticVirtualTextWarn = {
          bg = c.bg_dark,
          fg = '#e0af68',
          italic = true,
        }
        hl.DiagnosticVirtualTextInfo = {
          bg = c.bg_dark,
          fg = c.info,
          italic = true,
        }
        hl.DiagnosticVirtualTextHint = {
          bg = c.bg_dark,
          fg = c.hint,
          italic = true,
        }

        -- Enhanced diagnostic underlines
        hl.DiagnosticUnderlineError = {
          undercurl = true,
          sp = c.error,
        }
        hl.DiagnosticUnderlineWarn = {
          undercurl = true,
          sp = '#e0af68', -- Bright yellow underline for warnings
        }
        hl.DiagnosticUnderlineInfo = {
          undercurl = true,
          sp = c.info,
        }
        hl.DiagnosticUnderlineHint = {
          undercurl = true,
          sp = c.hint,
        }

        -- Gitsigns sign column (bar colors distinguish add vs change vs delete)
        hl.GitSignsAdd = { fg = '#73daca' } -- teal-green
        hl.GitSignsChange = { fg = '#e0af68' } -- amber: modified in place
        hl.GitSignsDelete = { fg = '#f7768e' } -- red

        -- Gitsigns line-number highlights (numhl)
        hl.GitSignsAddNr = { fg = '#73daca', bold = true }
        hl.GitSignsChangeNr = { fg = '#e0af68', bold = true }
        hl.GitSignsDeleteNr = { fg = '#f7768e', bold = true }

        -- Gitsigns line highlights (diff review mode: linehl=true)
        -- Green = new content (add/change/changedelete), Red = removed content
        -- Matches delta/fzf convention: new line is always green
        hl.GitSignsAddLn = { bg = '#1a3020' } -- green: new line
        hl.GitSignsChangeLn = { bg = '#1a3020' } -- green: current line is new content
        hl.GitSignsDeleteLn = { bg = '#2d1a1a' } -- red: removed line (virtual)
        hl.GitSignsChangeDeleteLn = { bg = '#1a3020' } -- green: new content replacing deleted

        -- Gitsigns word-diff inline highlights
        hl.GitSignsAddInline = { bg = '#1f4a2e', bold = true } -- stronger green for changed words
        hl.GitSignsChangeInline = { bg = '#1a3060', bold = true } -- stronger blue for changed words
        hl.GitSignsDeleteInline = { bg = '#4a1a1a', bold = true } -- stronger red for deleted words
      end,
    })

    -- Set colorscheme with error handling
    local ok, err = pcall(vim.cmd.colorscheme, 'tokyonight-night')
    if not ok then
      notify.warn('Tokyonight', 'Failed to load tokyonight-night: ' .. err)
      -- Fallback to default colorscheme
      vim.cmd.colorscheme('default')
    end
  end,
}
