# ZINIT package manager home
export ZINIT_HOME="${ZINIT_HOME:-$HOME/.local/share/zinit/zinit.git}"

# PATH needed by scripts and non-interactive shells
export PATH="$HOME/.local/bin:$PATH"
export PATH="$HOME/.go/bin:$PATH"
export PATH="$HOME/.config/signal-sync:$PATH"

export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"

export EDITOR=nvim
export PASSWORD_STORE_DIR=/data/stash/pass
export PRETTIERD_DEFAULT_CONFIG="$HOME/.config/prettierd/.prettierrc"

# oh-my-openagent — disable PostHog telemetry. The runtime check is env-only:
# ~/.omo/omo.jsonc uses OmoConfigSchema (strict) which rejects `telemetry`
# at root. Set both flags so the check trips regardless of product prefix.
export OMO_DISABLE_POSTHOG=1
export OMO_SEND_ANONYMOUS_TELEMETRY=0

# OS/distro — single source of truth, available in all shell contexts
if [[ "$(uname)" == "Darwin" ]]; then
  export _DISTRO=macos
elif grep -q '^ID=void' /etc/os-release 2>/dev/null || [[ -f /etc/void-release ]]; then
  export _DISTRO=void
elif grep -q '^ID=arch' /etc/os-release 2>/dev/null || [[ -f /etc/arch-release ]]; then
  export _DISTRO=arch
else
  export _DISTRO=linux
fi

# XDG — Linux only; session type inferred from environment when not already set by DM
if [[ "$_DISTRO" != "macos" ]]; then
  export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
  if [[ -z "$XDG_SESSION_TYPE" ]]; then
    if [[ -n "$WAYLAND_DISPLAY" ]]; then
      export XDG_SESSION_TYPE=wayland
    elif [[ -n "$DISPLAY" ]]; then
      export XDG_SESSION_TYPE=x11
    else
      export XDG_SESSION_TYPE=wayland
    fi
  fi
  : "${XDG_CURRENT_DESKTOP:=sway}"
  export XDG_CURRENT_DESKTOP
else
  unset XDG_RUNTIME_DIR XDG_SESSION_TYPE XDG_CURRENT_DESKTOP 2>/dev/null
fi

typeset -U path PATH

# Disable claude-code self-updater. Without this, every `claude` invocation
# triggers `bun install @anthropic-ai/claude-code@latest` which extracts
# ~280 MiB into ~/.cache/managed-bun/install/cache/.tmp/ — when earlyoom
# kills bun mid-extract, those tarballs are orphaned (observed 246 GiB).
# https://docs.claude.com/en/docs/claude-code/env-variables#disable_autoupdater
export DISABLE_AUTOUPDATER=true
export CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE=false
export AUTO_UPDATER_DISABLED=true

# Bun has its own self-update check on every run, same failure mode.
export BUN_AUTO_UPDATE_DISABLED=true

# Self-contained helpers — available in all shell contexts, not just interactive
cpr() {
  {
    echo "$ $*"
    eval "$*"
  } | clipboard-copy
}
