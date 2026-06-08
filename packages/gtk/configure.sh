#!/usr/bin/env bash
set -euo pipefail

# GTK theming is driven by the org.gnome.desktop.interface gsettings keys, not by
# the gtk-3.0/gtk-4.0 settings.ini files (those are only a fallback when no
# settings source is active). GTK3 apps (Thunar) honor `gtk-theme`; GTK4 +
# libadwaita apps (Nautilus) IGNORE `gtk-theme` and follow `color-scheme` only —
# that is why Nautilus stayed light while Thunar was dark. `prefer-dark` fixes it.

if ! command -v gsettings >/dev/null 2>&1; then
  echo "gsettings not found — skipping (install glib2 / gsettings-desktop-schemas)."
  exit 0
fi

set_key() {
  local key="$1" value="$2"
  local current
  current="$(gsettings get org.gnome.desktop.interface "$key" 2>/dev/null || echo)"
  if [ "$current" = "'$value'" ]; then
    echo "  ✓ $key already '$value'"
  else
    gsettings set org.gnome.desktop.interface "$key" "$value"
    echo "  → $key = '$value'"
  fi
}

echo "Applying GTK interface settings…"
set_key color-scheme "prefer-dark"
set_key gtk-theme "Tokyonight-Dark"
set_key icon-theme "Tokyonight-Dark"
set_key cursor-theme "Bibata-Original-Classic"
set_key font-name "Source Sans 3 11"

# cursor-size is an int, not a string — set directly.
gsettings set org.gnome.desktop.interface cursor-size 32
echo "  → cursor-size = 32"

echo "Done. libadwaita apps (Nautilus) now follow the dark color-scheme."
