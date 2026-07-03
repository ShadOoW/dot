# ZINIT[] associative array — must be set before sourcing zinit.zsh
typeset -gA ZINIT
if [ -f "$HOME/.cache/.managed" ]; then
  ZINIT[HOME_DIR]="$HOME/.cache/managed-zinit/polaris"
  ZINIT[PLUGINS_DIR]="$HOME/.cache/managed-zinit/polaris/plugins"
  ZINIT[SNIPPETS_DIR]="$HOME/.cache/managed-zinit/polaris/snippets"
  ZINIT[COMPLETIONS_DIR]="$HOME/.cache/managed-zinit/polaris/completions"
fi
ZINIT[COMPINIT_OPTS]="-C"

if [ ! -f "$ZINIT_HOME/zinit.zsh" ]; then
  mkdir -p "$(dirname "$ZINIT_HOME")"
  _zinit_lock="${ZINIT_HOME}.lock"
  # mkdir is atomic on every POSIX fs, so it doubles as a portable
  # cross-shell mutex (flock isn't available on macOS). Multiple terminals
  # opening at once used to race a git-clone into the same directory,
  # corrupting it; only the shell that wins the mkdir may clone.
  _zinit_waited=0
  while ! mkdir "$_zinit_lock" 2>/dev/null; do
    [ -f "$ZINIT_HOME/zinit.zsh" ] && break
    # Drop a lock held (crashed holder) for over 2 minutes rather than hang forever.
    if [ -n "$(find "$_zinit_lock" -maxdepth 0 -mmin +2 2>/dev/null)" ]; then
      rmdir "$_zinit_lock" 2>/dev/null
      continue
    fi
    sleep 0.2
    _zinit_waited=$((_zinit_waited + 1))
    [ "$_zinit_waited" -gt 300 ] && break
  done
  if [ ! -f "$ZINIT_HOME/zinit.zsh" ] && [ -d "$_zinit_lock" ]; then
    _zinit_tmp="$(mktemp -d "${ZINIT_HOME}.XXXXXX")"
    # GIT_CONFIG_GLOBAL=/dev/null skips ~/.gitconfig's https->ssh insteadOf
    # rewrite: this bootstrap clone must succeed before ssh-agent/keys are
    # set up (07-ssh-agent.zsh only covers the .zprofile stage), so it
    # can't depend on SSH auth being ready yet. Cloning into a temp dir and
    # renaming atomically means a killed/interrupted clone never leaves a
    # half-written directory at $ZINIT_HOME for the next shell to trip on.
    if GIT_CONFIG_GLOBAL=/dev/null git clone -q https://github.com/zdharma-continuum/zinit.git "$_zinit_tmp"; then
      rm -rf "$ZINIT_HOME"
      mv "$_zinit_tmp" "$ZINIT_HOME"
    else
      rm -rf "$_zinit_tmp"
    fi
  fi
  [ -d "$_zinit_lock" ] && rmdir "$_zinit_lock" 2>/dev/null
  unset _zinit_lock _zinit_waited _zinit_tmp
fi
source "${ZINIT_HOME}/zinit.zsh"

zinit wait"0" lucid light-mode for \
  zdharma-continuum/zinit-annex-as-monitor \
  zdharma-continuum/zinit-annex-bin-gem-node \
  zdharma-continuum/zinit-annex-patch-dl \
  zdharma-continuum/zinit-annex-rust

zinit ice wait"1" lucid blockf
zinit light Aloxaf/fzf-tab

zinit ice wait"1" lucid blockf
zinit light zsh-users/zsh-autosuggestions

zinit ice wait"1" lucid atload'
  bindkey "^[[A" history-substring-search-up
  bindkey "^[[B" history-substring-search-down
  bindkey "^[OA" history-substring-search-up
  bindkey "^[OB" history-substring-search-down
'
zinit light zsh-users/zsh-history-substring-search

zinit ice wait"1" lucid
zinit light zdharma-continuum/fast-syntax-highlighting

zinit ice wait"1" lucid
zinit snippet OMZP::extract
