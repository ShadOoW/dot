# fuzzel - Wayland-native app launcher

`xbps-install fuzzel`

## Overview

Fuzzel is a lightweight, Wayland-native application launcher similar to rofi's drun mode.
This package provides a unified app launcher that combines:

- Native Linux desktop applications (from .desktop files)
- PWA applications (from Vivaldi)

## Files

- `home/.config/fuzzel/fuzzel.ini` - Main configuration with Tokyo Night theme
- `home/.config/fuzzel-scripts/app-launcher.sh` - Script that merges native apps + PWAs
- `home/.config/fuzzel-scripts/priority` - Hand-pinned launcher order (see Ranking)

## Keybinding

- `mod+d` - Open app launcher (handled by sway keybindings)

## Ranking

`app-launcher.sh` runs fuzzel with `--no-sort`, so the order it feeds fuzzel is the order
matches appear in: names listed in `priority` (top first), then most-launched
(`~/.cache/fuzzel-apps/usage.tsv`), then alphabetical. Without `--no-sort` fuzzel re-ranks
by fzf score and typing `chat` put ChatGPT above Google Chat regardless of usage. To pin an
app, add its display name — first column of `~/.cache/fuzzel-apps/apps.tsv` — to `priority`.

## PWA Support

PWA .desktop files are read from `~/.local/share/applications/vivaldi-*-*.desktop`
and merged with native desktop entries. Custom icons are assigned to known PWAs.

## Custom Icons

| App      | Icon |
| -------- | ---- |
| ChatGPT  | 󱜸    |
| Discord  | 󰟮    |
| WhatsApp | 󰊫    |
| Gmail    | 󰊫    |
| YouTube  | 󰗃    |
| Telegram | 󰀲    |
| Spotify  | 󰓇    |
| Reddit   | 󰌀    |

All other apps use the fallback icon from the icon theme.

## Dependencies

- fuzzel
- Inter font (for UI)
- JetBrainsMono Nerd Font (fallback monospace)
- Vivaldi (for PWA desktop files)
