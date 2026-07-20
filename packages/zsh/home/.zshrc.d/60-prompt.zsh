autoload -Uz vcs_info
precmd() {
  vcs_info
  _clock_arm
}
zstyle ':vcs_info:git:*' formats ' %F{yellow} %b%f'
zstyle ':vcs_info:git:*' actionformats ' %F{yellow} %b|%F{red}%a%f'
setopt prompt_subst

# Distro glyph (Nerd Font) — at-a-glance cue for which system we're on.
# We dual-boot Arch/Void, so the prompt should say which one without `uname`.
# Sourced from $_DISTRO (set once in .zshenv). Codepoints are nf-linux-* glyphs;
# if one renders as a box, swap it from https://www.nerdfonts.com/cheat-sheet.
case "$_DISTRO" in
  arch) _distro_icon=$'%F{blue}%f' ;;   # nf-linux-archlinux
  void) _distro_icon=$'%F{green}%f' ;;  # nf-linux-void
  macos) _distro_icon=$'%F{white}%f' ;; # nf-linux-apple
  *) _distro_icon=$'%F{white}%f' ;;     # nf-fa-linux (tux) fallback
esac

# Arrows turn red when the last command failed (%(?...) = exit-status ternary).
_arrows='%(?.%F{red}❯%F{yellow}❯%F{green}❯.%F{red}❯❯❯)%f'

# Background-job cue: when this shell owns jobs, show live per-state counts so a
# parked job (a paused Claude agent, say) isn't forgotten. $_bgz_jobs is rebuilt
# every prompt by _bgz_precmd in 70-keybindings.zsh — green play-glyph + N running
# in the background, yellow pause-glyph + M paused. Ctrl+Z pauses/hides the current
# foreground job (see 70-keybindings.zsh).
# NOTE: $_bgz_jobs is escaped (\$) so it stays literal in PROMPT and prompt_subst
# re-expands it on every draw. Un-escaped, it would be frozen to its empty value
# at source time and the job counter would never appear (RPROMPT below is already
# single-quoted for the same reason).
PROMPT="${_distro_icon} %B%F{blue}%c%f%b \${_bgz_jobs}${_arrows} "

# Right side: git branch (from vcs_info) + clock. 24h HH:MM by default;
# for the 12h "01:35 pm" style instead use: %D{%I:%M %p}
# NOTE: color8 == color0 (#414868) in our Tokyo Night theme, so %F{8} is nearly
# invisible. Use a theme-independent 256-colour mid-grey (244) for a readable
# but understated clock.
RPROMPT='%B${vcs_info_msg_0_}%b %F{244}%D{%H:%M}%f'

# Live clock ─────────────────────────────────────────────────────────────────
# %D{%H:%M} above is only re-rendered when the prompt is drawn, so while the
# shell sits idle between commands the clock freezes at the time of your last
# enter-press. Redraw the prompt on a timer so it stays truthful.
#
# TMOUT fires SIGALRM after N idle seconds at the prompt; a defined TRAPALRM
# handles it (and, by existing, suppresses TMOUT's default "log out" action).
# `zle reset-prompt` re-expands PROMPT/RPROMPT — refreshing the clock — while
# preserving whatever is already typed on the line. We re-arm to the next
# minute boundary rather than a flat 60s, so the digits flip exactly when the
# minute rolls over and we wake at most once a minute.
zmodload zsh/datetime # provides $EPOCHSECONDS
_clock_arm() { TMOUT=$((60 - EPOCHSECONDS % 60)); }
_clock_arm # arm before the first prompt
TRAPALRM() {
  zle reset-prompt
  _clock_arm
}
