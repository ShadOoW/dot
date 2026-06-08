-- Full border UI
require('full-border'):setup()

-- Git status in file list
require('git'):setup()

-- Relative number motions
require('relative-motions'):setup({ show_numbers = 'relative', show_motion = true })

-- fr.yazi search (rg + rga channels)
require('fr'):setup({
  rga = {
    '--follow',
    '--hidden',
    '--no-ignore',
    '--glob',
    '\'!.git\'',
    '--glob',
    '\'!node_modules\'',
    '--glob',
    '\'!.venv\'',
    '--glob',
    '\'!venv\'',
    '--glob',
    '\'!__pycache__\'',
  },
})

-- Bookmarks
require('bookmarks'):setup({
  save_path = os.getenv('HOME') .. '/.local/share/yazi/bookmarks',
  notify = {
    enable = true,
    timeout = 1,
    message = {
      new = 'New bookmark: ',
      delete = 'Deleted: ',
      delete_all = 'Deleted all bookmarks',
    },
  },
})
