# Wayland / Sway Setup

## Core Packages

```
sway swaybg swayidle swaylock
waybar
mako                    # notifications
fuzzel                  # launcher (replaces rofi on Wayland)
wl-clipboard cliphist   # clipboard
slurp                   # region selector for screenshots
wl-screenrec            # screen recording
xdg-desktop-portal-wlr  # portal for screen sharing
wlsunset                # night light
mpvpaper                # video wallpaper
nwg-look                # GTK appearance tool
```

## Rofi (optional, Wayland fork)

```
rofi-wayland
```

## Notifications

```
mako   # lightweight, Wayland-native
```

## Clipboard Manager

```
wl-clipboard   # wl-copy / wl-paste
cliphist       # clipboard history (integrates with rofi/fuzzel)
```

## Session Start

Sway is started from the TTY or a display manager:

```
exec sway
```

Config is managed by the `sway` package:

```
dot pkg sway link
dot pkg waybar link
dot pkg mako link
dot pkg fuzzel link
```
