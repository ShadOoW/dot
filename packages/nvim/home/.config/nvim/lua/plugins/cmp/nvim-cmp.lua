return {
  'hrsh7th/nvim-cmp',
  event = { 'InsertEnter' },
  dependencies = { 'hrsh7th/cmp-nvim-lsp', 'hrsh7th/cmp-buffer', 'hrsh7th/cmp-path', 'hrsh7th/cmp-cmdline' },
  config = function()
    local cmp = require('cmp')
    local palette = require('utils.palette')

    cmp.setup({
      -- The menu never opens on its own — `autocomplete = false` disables the
      -- event-driven path entirely, leaving `cmp.complete()` as the only way in.
      -- Signature help still appears automatically (noice.nvim), so the useful
      -- half of "what goes here" arrives unprompted while the half that *edits
      -- the buffer* waits to be asked.  And nothing is preselected, so <CR> is
      -- always a newline: pick with <C-j>/<C-k>, or <C-y> to take the top entry.
      preselect = cmp.PreselectMode.None,
      completion = {
        autocomplete = false,
        completeopt = 'menu,menuone,noselect',
      },
      snippet = {
        expand = function(args)
          -- Use LSP snippet expansion if available
          vim.snippet.expand(args.body)
        end,
      },
      mapping = cmp.mapping.preset.insert({
        -- One key, three levels of detail: nothing → the list of names → the
        -- documentation for the entry under the cursor → back to just the list.
        ['<C-Space>'] = cmp.mapping(function()
          if not cmp.visible() then
            cmp.complete()
          elseif cmp.visible_docs() then
            cmp.close_docs()
          else
            cmp.open_docs()
          end
        end, { 'i' }),
        ['<C-e>'] = cmp.mapping.abort(),
        ['<CR>'] = cmp.mapping.confirm({
          select = false,
        }),
        ['<C-j>'] = cmp.mapping.select_next_item(),
        ['<C-k>'] = cmp.mapping.select_prev_item(),
        ['<Down>'] = cmp.mapping(function(fallback)
          if cmp.visible() then
            cmp.select_next_item()
          else
            fallback()
          end
        end, { 'i', 's' }),
        ['<Up>'] = cmp.mapping(function(fallback)
          if cmp.visible() then
            cmp.select_prev_item()
          else
            fallback()
          end
        end, { 'i', 's' }),
        ['<C-u>'] = cmp.mapping.scroll_docs(-4),
        ['<C-d>'] = cmp.mapping.scroll_docs(4),
      }),
      sources = cmp.config.sources({
        {
          name = 'nvim_lsp',
          priority = 1000,
          entry_filter = function(entry)
            local kind = entry:get_kind()
            return kind ~= cmp.lsp.CompletionItemKind.Text
          end,
        },
        {
          name = 'path',
          priority = 500,
        },
      }, {
        {
          name = 'buffer',
          keyword_length = 4,
          max_item_count = 5,
          priority = 250,
        },
      }),
      formatting = {
        fields = { 'abbr', 'kind', 'menu' },
        expandable_indicator = false,
        format = function(entry, vim_item)
          -- LSP is the source for almost every entry, so labelling it says
          -- nothing and costs six columns of popup width on every row — width
          -- that lands on the code behind it.  Only mark the exceptions.
          local menus = {
            buffer = '[buf]',
            path = '[path]',
          }

          local function truncate(str, max)
            if not str then return '' end
            if #str <= max then return str end
            return string.sub(str, 1, max - 1) .. '…'
          end

          vim_item.abbr = truncate(vim_item.abbr, 40)
          vim_item.menu = menus[entry.source.name] or ''
          return vim_item
        end,
      },
      -- No ghost text: the menu already shows the entry, and previewing it
      -- inline paints a second copy of the word you are typing over the buffer
      -- — which then fights the AI suggestion drawn in the same spot.
      experimental = {
        ghost_text = false,
      },
      window = {
        completion = cmp.config.window.bordered({
          border = 'rounded',
          winhighlight = 'Normal:CmpPmenu,FloatBorder:CmpPmenuBorder,CursorLine:CmpPmenuSel,Search:None',
          zindex = 60,
        }),
        documentation = cmp.config.window.bordered({
          border = 'rounded',
          winhighlight = 'Normal:CmpDoc,FloatBorder:CmpDocBorder,Search:None',
          zindex = 60,
          max_height = 12,
          max_width = 60,
        }),
      },
      performance = {
        max_view_entries = 8,
        -- Let a burst of keystrokes settle before redrawing, so the menu stops
        -- flickering open and closed mid-word.
        debounce = 80,
        throttle = 40,
      },
      view = {
        entries = {
          name = 'custom',
          selection_order = 'near_cursor',
        },
        -- Documentation is a third level, not a companion to the menu: at 60x12
        -- it lands on top of the code and the signature help you were reading.
        -- <C-Space> reveals it when the entry name is not enough.
        docs = {
          auto_open = false,
        },
      },
    })

    -- Compact modern popup styling
    vim.api.nvim_set_hl(0, 'CmpPmenu', {
      bg = palette.base,
      fg = palette.text,
    })
    vim.api.nvim_set_hl(0, 'CmpPmenuBorder', {
      fg = palette.tn_border,
      bg = palette.base,
    })
    vim.api.nvim_set_hl(0, 'CmpPmenuSel', {
      bg = palette.sel_bg,
      fg = palette.text,
      bold = true,
    })
    vim.api.nvim_set_hl(0, 'CmpDoc', {
      bg = palette.base,
      fg = palette.text,
    })
    vim.api.nvim_set_hl(0, 'CmpDocBorder', {
      fg = palette.tn_border,
      bg = palette.base,
    })

    -- The cmdline keeps popping up on its own: it draws over the message area
    -- rather than the code, and `:` completion is worth nothing if you have to
    -- ask for it.  Re-enable the trigger the global config turned off.
    local cmdline_autocomplete = {
      autocomplete = { cmp.TriggerEvent.TextChanged },
    }

    -- Use buffer source for `/` and `?`
    cmp.setup.cmdline({ '/', '?' }, {
      completion = cmdline_autocomplete,
      mapping = cmp.mapping.preset.cmdline(),
      sources = { {
        name = 'buffer',
      } },
    })

    -- Use cmdline & path source for ':'
    cmp.setup.cmdline(':', {
      completion = cmdline_autocomplete,
      mapping = cmp.mapping.preset.cmdline(),
      sources = cmp.config.sources({ {
        name = 'path',
      } }, { {
        name = 'cmdline',
      } }),
    })
  end,
}
