return {
  'alexpasmantier/tv.nvim',
  dependencies = { 'nvim-tree/nvim-web-devicons' },
  build = ':TvInstallBinary',
  config = function()
    local h = require('tv').handlers

    require('tv').setup({
      tv_binary = 'tv',
      layout = 'landscape',
      quickfix = { auto_open = true },
      window = {
        width = 0.85,
        height = 0.85,
        border = 'rounded',
        title = ' television ',
        title_pos = 'center',
      },
      global_keybindings = { channels = '<leader>sC' },
      channels = {
        files = {
          -- <C-p> is the fzf-lua file finder; tv files gets its own key
          keybinding = '<leader>sT',
          handlers = {
            ['<CR>'] = h.open_as_files,
            ['<C-s>'] = h.open_in_split,
            ['<C-v>'] = h.open_in_vsplit,
            ['<C-q>'] = h.send_to_quickfix,
            ['<C-y>'] = h.copy_to_clipboard,
          },
        },
        text = {
          handlers = {
            ['<CR>'] = h.open_at_line,
            ['<C-s>'] = h.open_in_split,
            ['<C-v>'] = h.open_in_vsplit,
            ['<C-q>'] = h.send_to_quickfix,
            ['<C-y>'] = h.copy_to_clipboard,
          },
        },
        ['git-log'] = {
          keybinding = '<leader>sL',
          handlers = {
            ['<CR>'] = h.open_in_scratch,
            ['<C-y>'] = h.copy_to_clipboard,
          },
        },
        ['git-branch'] = {
          keybinding = '<leader>sB',
          handlers = {
            ['<CR>'] = h.execute_shell_command('git checkout {}'),
            ['<C-d>'] = h.execute_shell_command('git branch -d {}'),
            ['<C-r>'] = h.execute_shell_command('git rebase {}'),
            ['<C-y>'] = h.copy_to_clipboard,
          },
        },
        ['git-stash'] = {
          handlers = {
            ['<CR>'] = h.execute_shell_command('git stash pop {}'),
            ['<C-d>'] = h.execute_shell_command('git stash drop {}'),
            ['<C-y>'] = h.copy_to_clipboard,
          },
        },
        ['git-diff'] = {
          handlers = {
            ['<CR>'] = h.open_in_scratch,
            ['<C-q>'] = h.send_to_quickfix,
          },
        },
        ['zsh-history'] = {
          -- <leader>sH is fzf-lua help tags
          keybinding = '<leader>sz',
          layout = 'portrait',
          handlers = {
            ['<CR>'] = h.insert_at_cursor,
            ['<C-l>'] = h.insert_on_new_line,
            ['<C-y>'] = h.copy_to_clipboard,
          },
        },
        env = {
          keybinding = '<leader>sE',
          layout = 'portrait',
          handlers = {
            ['<CR>'] = h.insert_at_cursor,
            ['<C-l>'] = h.insert_on_new_line,
            ['<C-y>'] = h.copy_to_clipboard,
          },
        },
        ['ssh-hosts'] = {
          handlers = {
            ['<CR>'] = h.execute_shell_command('kitty ssh {}'),
            ['<C-y>'] = h.copy_to_clipboard,
          },
        },
        ['tmux-sessions'] = {
          handlers = {
            ['<CR>'] = h.execute_shell_command('tmux switch-client -t {}'),
            ['<C-d>'] = h.execute_shell_command('tmux kill-session -t {}'),
            ['<C-y>'] = h.copy_to_clipboard,
          },
        },
        ['npm-scripts'] = {
          -- <leader>sn is the fzf-lua Noice messages picker
          keybinding = '<leader>sN',
          layout = 'portrait',
          handlers = {
            ['<CR>'] = h.execute_shell_command('npm run {}'),
            ['<C-y>'] = h.copy_to_clipboard,
          },
        },
        ['gh-prs'] = {
          handlers = {
            ['<CR>'] = h.execute_shell_command('gh pr checkout {}'),
            ['<C-o>'] = h.execute_shell_command('gh pr view {} --web'),
            ['<C-y>'] = h.copy_to_clipboard,
          },
        },
        ['gh-issues'] = {
          handlers = {
            ['<CR>'] = h.execute_shell_command('gh issue view {} --web'),
            ['<C-y>'] = h.copy_to_clipboard,
          },
        },
        ['docker-images'] = {
          handlers = {
            ['<CR>'] = h.execute_shell_command('docker run -it {}'),
            ['<C-d>'] = h.execute_shell_command('docker rmi {}'),
            ['<C-y>'] = h.copy_to_clipboard,
          },
        },
        ['docker-containers'] = {
          handlers = {
            ['<CR>'] = h.execute_shell_command('docker exec -it {} sh'),
            ['<C-d>'] = h.execute_shell_command('docker rm -f {}'),
            ['<C-y>'] = h.copy_to_clipboard,
          },
        },
      },
    })
  end,
}
