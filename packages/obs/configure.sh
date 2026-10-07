#!/usr/bin/env bash
# Copy the `meetings` profile and scene collection into OBS's settings on the Mac, and seed
# the two files OBS must own.
#
# Copies, never links, for two traps read in OBS 32.2.2's source:
# - OBS replaces its own settings files when it saves: config_save_safe
#   (libobs/util/config-file.c) writes a temporary file and renames it over the old one
#   (os_safe_replace, libobs/util/platform-nix.c, a bare rename, on macOS too), and the scene
#   collection is saved the same way (os_quick_write_utf8_file_safe). A link from this
#   package would silently become a real file at OBS's first save.
# - obs-websocket writes its file the other way, in place and through any link
#   (src/utils/Json.cpp, SetJsonFileContent), and writes its generated password into it
#   (src/Config.cpp, Config::Save). Linked, the password would land in this repository. So
#   that file and user.ini are seeded only when absent and never overwritten.
#
# The files live in obs-studio/, outside home/ and system/, so dot's linker cannot reach
# them (collectFiles), as packages/secrets does with templates/. For the same reason
# `dot doctor` cannot report drift here: a change made in OBS's settings window lasts until
# the next run of this script.
#
# Runs unprivileged. `dot pkg obs configure` asks for sudo first; this script needs none and
# can be run directly: bash ~/code/dot/packages/obs/configure.sh
# Design: egghead step 21j §9.3.3.
set -euo pipefail

if pgrep -x OBS >/dev/null; then
  echo "OBS is running; quit it first — it rewrites its settings when it quits, over anything copied now" >&2
  exit 1
fi

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/obs-studio"
D="$HOME/Library/Application Support/obs-studio"

install -d "$D/basic/profiles/meetings" "$D/basic/scenes" "$D/plugin_config/obs-websocket" "$HOME/Movies/meetings"

# rm -f first: install onto a symlink would write through it, into its target.
for f in \
  basic/profiles/meetings/basic.ini \
  basic/profiles/meetings/recordEncoder.json \
  basic/profiles/meetings/streamEncoder.json \
  basic/profiles/meetings/service.json \
  basic/scenes/meetings.json; do
  rm -f "$D/$f"
  install -m 644 "$SRC/$f" "$D/$f"
  echo "copied $f"
done

seed() {
  local f=$1 mode=$2
  if [ -e "$D/$f" ] || [ -L "$D/$f" ]; then
    echo "kept $f"
  else
    install -m "$mode" "$SRC/$f.seed" "$D/$f"
    echo "seeded $f"
  fi
}
seed user.ini 644
seed plugin_config/obs-websocket/config.json 600
