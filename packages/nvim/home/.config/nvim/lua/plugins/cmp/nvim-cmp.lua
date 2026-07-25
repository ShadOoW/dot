return {
  'hrsh7th/nvim-cmp',
  event = { 'InsertEnter' },
  dependencies = { 'hrsh7th/cmp-nvim-lsp', 'hrsh7th/cmp-buffer', 'hrsh7th/cmp-path', 'hrsh7th/cmp-cmdline' },
  config = function()
    local cmp = require('cmp')
    local palette = require('utils.palette')

    cmp.setup({
      preselect = cmp.PreselectMode.Item,
      completion = {
        autocomplete = { cmp.TriggerEvent.TextChanged },
        completeopt = 'menu,menuone,noinsert',
      },
      snippet = {
        expand = function(args)
          -- Use LSP snippet expansion if available
          vim.snippet.expand(args.body)
        end,
      },
      mapping = cmp.mapping.preset.insert({
        ['<C-Space>'] = cmp.mapping(function()
          if cmp.visible() then cmp.close() end
          cmp.complete()
        end, { 'i' }),
        ['<C-e>'] = cmp.mapping.abort(),
        ['<CR>'] = cmp.mapping.confirm({
          select = true,
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
          local menus = {
            nvim_lsp = '[LSP]',
            buffer = '[BUF]',
            path = '[PATH]',
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
      experimental = {
        ghost_text = {
          hl_group = 'CmpGhostText',
        },
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
        max_view_entries = 10,
      },
      view = {
        entries = {
          name = 'custom',
          selection_order = 'near_cursor',
        },
      },
    })

    -- Improve ghost text visibility
    vim.api.nvim_set_hl(0, 'CmpGhostText', {
      fg = palette.tn_blue,
      italic = true,
      nocombine = true,
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

    -- Use buffer source for `/` and `?`
    cmp.setup.cmdline({ '/', '?' }, {
      mapping = cmp.mapping.preset.cmdline(),
      sources = { {
        name = 'buffer',
      } },
    })

    -- Use cmdline & path source for ':'
    cmp.setup.cmdline(':', {
      mapping = cmp.mapping.preset.cmdline(),
      sources = cmp.config.sources({ {
        name = 'path',
      } }, { {
        name = 'cmdline',
      } }),
    })
  end,
}
