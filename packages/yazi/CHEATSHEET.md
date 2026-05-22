# Yazi Cheatsheet

## Navigate

| Key             | Action                              |
| --------------- | ----------------------------------- |
| `h / l`         | Parent dir / enter dir or open file |
| `j / k`         | Down / Up                           |
| `gg / G`        | Top / Bottom                        |
| `C-u / C-d`     | Half-page up / down                 |
| `<C-j> / <C-k>` | Scroll preview pane                 |
| `f<char>`       | Jump to char                        |
| `z`             | Zoxide jump (fzf)                   |
| `C-f`           | Smart filter (type to narrow)       |
| `.`             | Toggle hidden files                 |

## Relative motions (navigation only)

Press a number then `j` or `k`. The count shows at the bottom.
Example: `3j` = move down 3 rows. **Does not work with y/d/etc.**
Select multiple items with `Space`, then act on them.

## Go-to (`g…`)

| Key   | Target             |
| ----- | ------------------ |
| `gh`  | ~                  |
| `gc`  | ~/.config          |
| `gC`  | ~/.config/dotfiles |
| `go`  | /mnt/backup/code   |
| `gdd` | /data              |
| `gdc` | /data/code         |
| `gdw` | /data/downloads    |
| `gds` | /data/screens      |
| `gdm` | /data/media        |
| `gdo` | /data/ops          |
| `gdS` | /data/stash        |

## Files

| Key      | Action                              |
| -------- | ----------------------------------- |
| `Space`  | Toggle select (purple marker)       |
| `Escape` | Deselect all / cancel               |
| `a`      | Create (end with `/` for directory) |
| `r`      | Rename                              |
| `y`      | Copy (teal marker on file)          |
| `x`      | Cut (orange marker on file)         |
| `p`      | Paste                               |
| `d`      | Trash                               |
| `D`      | Delete permanently                  |
| `<A-d>`  | Drag & drop (ripdrag)               |

> Markers: **purple** = selected with Space · **teal** = copied · **orange** = cut

## Open / enter

| Key     | Behavior                                          |
| ------- | ------------------------------------------------- |
| `l`     | Navigate into dir / open file (smart-enter)       |
| `o`     | Pick opener interactively (nvim vs browser, etc.) |
| `Enter` | Dir → new kitty terminal (yazi hides)             |
| `Enter` | Text/code → nvim in new kitty (yazi hides)        |
| `Enter` | Image/video/PDF → xdg-open                        |
| `!`     | New kitty terminal in current dir                 |

> Press `mod+a` to bring yazi back after it hides itself.

## Tools (`;…`)

Press `;` to open the tools menu, then:

| Key | Action             |
| --- | ------------------ |
| `c` | Compress (ouch)    |
| `e` | Extract (ouch)     |
| `g` | Git log (tig)      |
| `m` | chmod              |
| `r` | Restore from trash |
| `d` | Diff               |

## Copy path (`Y…`)

`Yp` full path · `Yn` filename · `Yd` directory path

## Tabs

`t` new · `[` / `]` prev/next

## Bookmarks (`b…`)

`bm` set · `b'` jump · `bd` delete

## Misc

`?` this cheatsheet · `~` built-in help
