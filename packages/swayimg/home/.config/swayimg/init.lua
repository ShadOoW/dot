-- swayimg config. Searched for at $XDG_CONFIG_HOME/swayimg/init.lua (man 1 swayimg, FILES).
-- Full set of defaults with inline docs: /usr/share/swayimg/example.lua
--
-- Replaced feh (2026-08-05). feh has no Wayland backend and ran under XWayland, which is why
-- the old packages/feh/.../themes carried a `--geometry 1280x720` workaround: under XWayland
-- feh's first render centered the image against twice the real screen size, and only a resize
-- event made it re-render correctly. None of that applies to a Wayland-native viewer — sway
-- sizes the window correctly on the first configure, so the workaround is gone rather than
-- ported. Fullscreen still comes from sway ([app_id="swayimg"] in ../sway/rules), matching how
-- mpv is handled in the same block.

-- feh ran with `--auto-zoom --scale-down`: fit oversized images to the window, leave smaller
-- ones at real size. "optimal" is swayimg's equivalent, and is already the built-in default —
-- set explicitly so the intent survives a change of upstream defaults.
-- Other modes: fit, fill, width, height, real.
swayimg.viewer.default_scale = 'optimal'

-- No client-side title bar. sway draws borders (see ../sway/styling: default_floating_border
-- none, hide_edge_borders --i3 smart), and the window opens fullscreen anyway.
swayimg.decoration = false
