# fonts - System font configuration

Font configuration for Void Linux with Inter (Latin), Noto (CJK/Arabic/Emoji), and JetBrains Mono (monospace).

## Fonts

| Font                    | Purpose                      | Package             |
| ----------------------- | ---------------------------- | ------------------- |
| Inter                   | Latin sans-serif             | font-inter          |
| Noto Sans CJK           | Japanese, Simplified Chinese | noto-fonts-cjk-sans |
| Noto Sans Arabic        | Arabic script                | noto-fonts-ttf      |
| Noto Color Emoji        | Emoji                        | noto-fonts-emoji    |
| JetBrainsMono Nerd Font | Monospace for terminals/code | nerd-fonts-ttf      |
| Terminus                | Console TTY font             | terminus-font       |

## Operations

- `dot pkg fonts link` - Link fontconfig to ~/.config/fontconfig/
- `dot pkg fonts configure` - Install /etc/vconsole.conf as a real file and refresh the font cache

## Required Packages

```bash
sudo xbps-install -S font-inter noto-fonts-cjk-sans noto-fonts-emoji noto-fonts-ttf nerd-fonts-ttf terminus-font
```

## Files

- `home/.config/fontconfig/fonts.conf` - System-wide font preferences
- `etc-real/etc/vconsole.conf` - Console TTY font (FONT=ter-v16n)
