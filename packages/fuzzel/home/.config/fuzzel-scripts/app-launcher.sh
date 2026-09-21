#!/usr/bin/env bash
set -euo pipefail

CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/fuzzel-apps"
CACHE_FILE="$CACHE_DIR/apps.tsv"
USAGE_FILE="$CACHE_DIR/usage.tsv"

# Where .desktop files are, per the XDG basedir spec: $XDG_DATA_HOME/
# applications first, then one applications/ per entry in $XDG_DATA_DIRS.
# Hard-coding /usr/share/applications was true on Arch and Void and is false
# on NixOS, where the system profile is /run/current-system/sw/share and
# /usr/share does not exist — the launcher listed nothing at all there, which
# reads as "fuzzel is broken" rather than "the search path is wrong".
app_dirs() {
  local dirs="${XDG_DATA_HOME:-$HOME/.local/share}:${XDG_DATA_DIRS:-/usr/local/share:/usr/share}"
  local dir
  while IFS= read -r -d ':' dir || [ -n "$dir" ]; do
    [ -n "$dir" ] && [ -d "$dir/applications" ] && printf '%s\n' "$dir/applications"
  done <<<"$dirs:"
}

# Toggle: close fuzzel if already open
if pgrep -x fuzzel &>/dev/null; then
  pkill -x fuzzel || true
  exit 0
fi

build_cache() {
  mkdir -p "$CACHE_DIR"
  local tmp
  tmp=$(mktemp)

  mapfile -t _app_dirs < <(app_dirs)
  find "${_app_dirs[@]}" -maxdepth 1 -name '*.desktop' -print0 2>/dev/null |
    while IFS= read -r -d '' file; do
      awk '
            BEGIN { in_entry=0 }
            /^\[Desktop Entry\]/ {
                in_entry=1; name=""; exec=""; terminal=0; nodisplay=0; next
            }
            /^\[/ { in_entry=0; next }
            !in_entry { next }
            /^NoDisplay=true/ { nodisplay=1; next }
            /^Terminal=true/  { terminal=1;  next }
            /^Name=/          { if (!name) name=substr($0,6); next }
            /^Exec=/          { if (!exec) exec=substr($0,6); next }
            END {
                if (!name || !exec || terminal || nodisplay) exit
                if (name ~ /[Uu][Rr][Ll] [Hh]andler/) exit
                gsub(/ %[fFuUiIckdDnNvm]/, "", exec)
                gsub(/"/, "", exec)

                display = name

                # For non-PWA apps, add binary name as search hint when it
                # does not appear anywhere in the app name
                if (exec !~ /--app-id=/) {
                    binary = exec
                    sub(/ .*/, "", binary)   # first word only
                    sub(/.*\//, "", binary)   # strip path
                    # Skip shell/interpreter wrappers — not the real app binary
                    if (binary != "env" && binary != "sh" && binary != "bash" && binary != "zsh" &&
                        binary != "python" && binary != "python3" && binary != "ruby" && binary != "perl" &&
                        binary != "flatpak" && binary != "snap" && binary != "sudo" && binary != "pkexec") {
                        name_simple = tolower(name)
                        gsub(/[^a-z0-9]/, "", name_simple)
                        binary_simple = tolower(binary)
                        gsub(/[^a-z0-9]/, "", binary_simple)
                        if (length(binary_simple) > 1 &&
                            index(tolower(name), binary) == 0 &&
                            index(binary_simple, name_simple) == 0 &&
                            index(name_simple, binary_simple) == 0) {
                            display = name " (" binary ")"
                        }
                    }
                }

                printf "%s\t%s\n", display, exec
            }
        ' "$file" 2>/dev/null || true
    done >"$tmp"

  sort -f -t$'\t' -k1,1 "$tmp" | awk -F'\t' '!seen[$1]++' >"$CACHE_FILE"
  rm -f "$tmp"
}

needs_rebuild() {
  [[ ! -f "$CACHE_FILE" ]] && return 0
  mapfile -t _app_dirs < <(app_dirs)
  find "${_app_dirs[@]}" \
    -maxdepth 1 -name '*.desktop' -newer "$CACHE_FILE" -print 2>/dev/null |
    grep -q . && return 0
  return 1
}

if needs_rebuild; then
  build_cache
fi

# Generate display list: most-used apps first, then alphabetical
generate_list() {
  if [[ ! -f "$USAGE_FILE" ]]; then
    cut -f1 "$CACHE_FILE"
    return
  fi
  awk -F'\t' '
        NR==FNR { usage[$2]=int($1); next }
        { print (usage[$1]+0) "\t" $1 }
    ' "$USAGE_FILE" "$CACHE_FILE" |
    sort -t$'\t' -k1,1rn -k2,2f |
    cut -f2
}

selected=$(generate_list | fuzzel --dmenu --no-run-if-empty) || true
[[ -z "$selected" ]] && exit 0

exec_line=$(awk -F'\t' -v sel="$selected" '$1==sel { print $2; exit }' "$CACHE_FILE")
[[ -z "$exec_line" ]] && exit 0

# Update usage count
{
  if [[ -f "$USAGE_FILE" ]]; then
    awk -F'\t' -v app="$selected" '
            BEGIN { found=0 }
            $2 == app { printf "%d\t%s\n", $1+1, $2; found=1; next }
            { print }
            END { if (!found) printf "1\t%s\n", app }
        ' "$USAGE_FILE"
  else
    printf "1\t%s\n" "$selected"
  fi
} >"${USAGE_FILE}.tmp" && mv "${USAGE_FILE}.tmp" "$USAGE_FILE"

eval "$exec_line" &
