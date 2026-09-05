# sway - Window manager

xbps-install sway swaybg swayidle swaylock fuzzel

## Clean

- rm ~/.config/swayidle

## Never run `sway` to check a config

There is no safe validate flag here. `sway --validate -c ~/.config/sway/config` from a
shell with no `WAYLAND_DISPLAY` does not lint and exit — sway 1.12 falls through to the
**DRM backend**, takes the card, applies the config to the real monitor, and then hangs
contending for DRM master with the session that already has it. Observed 2026-08-28 while a
game was fullscreen: it silently reset DP-4's mode and had to be killed. It left no error
and printed nothing, which is why it reads as "the validator is slow".

Check a config line the way that cannot take the display, by asking the running compositor
to parse it:

```sh
swaymsg 'output "Lenovo Group Limited G24-20 U533A88N" mode 1920x1080@164.997Hz'
```

`swaymsg` returns `{"success":true}` on a line sway accepts and an error string on one it
does not. Output identifiers match **exactly** — a wrong serial matches nothing, applies
nothing, and still returns success at the command level, so verify with a property you can
read back (`swaymsg -t get_outputs`) rather than trusting the reply
[verified 2026-08-28: `max_render_time` applied under the exact identifier, ignored under a
garbage one].
