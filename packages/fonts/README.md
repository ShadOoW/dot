# fonts — font configuration

The desk's flake declares the fonts and the Mac installs them with brew; this package ships
the fontconfig both hosts read.

## Fonts

| Font                    | Purpose                      |
| ----------------------- | ---------------------------- |
| Inter                   | Latin sans-serif             |
| Noto Sans CJK           | Japanese, Simplified Chinese |
| Noto Sans Arabic        | Arabic script                |
| Noto Color Emoji        | Emoji                        |
| JetBrainsMono Nerd Font | Monospace for terminals/code |

## Operations

- `dot pkg fonts link` — link fontconfig to `~/.config/fontconfig/`
- `dot pkg fonts configure` — refresh the font cache

## Files

- `home/.config/fontconfig/fonts.conf` — the shared font preferences

`dot assets sync` fetches releases for JetBrainsMono, Inter, NotoSansCJK, NotoColorEmoji and
NotoSansArabic; it does not install them.
