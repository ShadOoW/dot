# Fonts

## Managed by dot assets (GitHub releases → ~/.local/share/fonts/)

```
dot assets sync JetBrainsMono    # JetBrains Mono Nerd Font
dot assets sync NotoSansCJK      # Noto Sans CJK (Chinese/Japanese/Korean)
dot assets sync NotoColorEmoji   # Noto Color Emoji
dot assets sync NotoArabic       # Noto Sans Arabic
dot assets sync Terminus         # Terminus bitmap font
```

After syncing, the font cache is refreshed automatically (`fc-cache -fv`).

## Managed by package manager (system-wide)

Inter (primary UI font) is installed system-wide:

```
xbps-install font-inter   # Void Linux
pacman -S inter-font       # Arch Linux
```

## Font config

Fontconfig preferences are managed by the `fonts` package:

```
dot pkg fonts link
```

This sets up:

- Inter as the default sans-serif UI font
- JetBrains Mono Nerd Font as monospace
- Noto fonts as fallbacks for CJK, Arabic, and emoji

## TTY Font

Terminus is configured for the TTY via `vconsole.conf` (installed by the `fonts` package).
