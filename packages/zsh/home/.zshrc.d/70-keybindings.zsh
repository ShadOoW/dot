function cd_up() {
  BUFFER="cd .."
  zle accept-line
}
function cd_back() {
  BUFFER="cd -"
  zle accept-line
}
function go_home_dir() {
  BUFFER="cd ~"
  zle accept-line
}
function run_ls() {
  BUFFER="ls"
  zle accept-line
}

zle -N cd_up
zle -N cd_back
zle -N go_home_dir
zle -N run_ls

bindkey "^[[5~" cd_up
bindkey "^[[6~" cd_back
bindkey -r '^[[H'
bindkey "^[OH" go_home_dir
bindkey -r '^[[F'
bindkey "^[OF" run_ls

bindkey "^[[1;5D" backward-word
bindkey "^[[1;5C" forward-word
bindkey "^[Od" backward-word
bindkey "^[Oc" forward-word

# ── Job control: Ctrl+Z = pause & hide ───────────────────────────────────────
#
# Ctrl+Z suspends the foreground app the usual way — the tty sends SIGTSTP (ZLE
# isn't reading while an app owns the terminal, so no widget fires then). The job
# is PAUSED and quiet. At an empty prompt Ctrl+Z instead runs `fg` to pull the
# current job back (then Ctrl+C stops it — SIGINT only reaches a foreground job).
#
# The prompt shows live counts via $_bgz_jobs: green  N running in the background,
# yellow  M paused.
zmodload zsh/parameter 2>/dev/null
autoload -Uz add-zsh-hook

typeset -g _bgz_jobs='' # prompt segment, consumed by PROMPT in 60-prompt.zsh

# Nerd-Font glyphs; swap from https://www.nerdfonts.com/cheat-sheet if boxed.
_bgz_run=$''   # nf-fa-play  — running in background
_bgz_pause=$'' # nf-fa-pause — paused

# precmd: rebuild the per-state job-count segment for the prompt (no side effects).
_bgz_precmd() {
  emulate -L zsh
  local j run=0 susp=0
  for j in ${(k)jobstates}; do
    case ${jobstates[$j]%%:*} in
      running) ((run++)) ;;
      suspended) ((susp++)) ;;
    esac
  done
  _bgz_jobs=''
  ((run)) && _bgz_jobs+="%F{green}${_bgz_run}${run}%f "
  ((susp)) && _bgz_jobs+="%F{yellow}${_bgz_pause}${susp}%f "
}
add-zsh-hook precmd _bgz_precmd

# Ctrl+Z: empty prompt → fg the current job; otherwise stash the half-typed line.
function fancy-ctrl-z() {
  if [[ $#BUFFER -eq 0 ]]; then
    BUFFER="fg"
    zle accept-line
  else
    zle push-input
    zle clear-screen
  fi
}
zle -N fancy-ctrl-z
bindkey '^Z' fancy-ctrl-z
