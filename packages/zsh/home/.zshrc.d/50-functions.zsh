function y() {
  local tmp
  tmp="$(mktemp -t yazi-cwd.XXXXXX)"
  yazi "$@" --cwd-file="$tmp"
  if cwd="$(<"$tmp")" && [ -n "$cwd" ] && [ "$cwd" != "$PWD" ]; then
    builtin cd -- "$cwd"
  fi
  rm -f -- "$tmp"
}

cf() {
  if [ -z "$1" ]; then
    echo "Usage: cf <filename>"
    return 1
  fi
  echo -n "$1" | clipboard-copy
  echo "Copied '$1' to clipboard."
}

copyimg() {
  if ! command -v wl-copy &>/dev/null; then
    echo "❌ copyimg requires wl-copy (Wayland only)" >&2
    return 1
  fi

  emulate -L zsh

  local file="$1"
  local tmp
  tmp=$(mktemp /tmp/clip-XXXXXX.png) || return 1

  trap 'rm -f "$tmp"' EXIT INT TERM

  if [[ -n "$file" ]]; then
    [[ ! -f "$file" ]] && {
      echo "❌ File not found: $file"
      return 1
    }

    if ! file --mime-type -b "$file" | grep -q '^image/'; then
      echo "❌ Not an image: $file"
      return 1
    fi

    wl-copy <"$file" || {
      echo "❌ Failed to copy to clipboard"
      return 1
    }
  fi

  if ! wl-paste --type image/png >"$tmp" 2>/dev/null; then
    echo "❌ Clipboard does not contain an image"
    return 1
  fi

  ${IMG_VIEWER:-feh} "$tmp"
}

zdrag() {
  ripdrag "$(fzf)"
}

rgaf() {
  local RG_PREFIX="rga --files-with-matches"
  local file
  file="$(
    FZF_DEFAULT_COMMAND="$RG_PREFIX ${*:-}" \
      fzf --sort \
      --preview="[[ ! -z {} ]] && rga --pretty --context 5 {q} {}" \
      --phony -q "${*:-}" \
      --bind "change:reload:$RG_PREFIX {q}" \
      --preview-window="70%:wrap"
  )" && nvim "$file"
}

copycommitmsg() {
  local ref="${1:-HEAD}"
  local msg
  msg="$(git log -1 --format=%B "$ref")" || {
    echo "❌ Failed to get commit message for '$ref'"
    return 1
  }
  echo -n "$msg" | clipboard-copy
  echo "✓ Copied commit message for '$ref' to clipboard"
}
