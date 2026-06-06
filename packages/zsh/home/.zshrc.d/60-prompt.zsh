autoload -Uz vcs_info
precmd() { vcs_info; }
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

PROMPT="${_distro_icon} %B%F{blue}%c%f%b ${_arrows} "

# Right side: git branch (from vcs_info) + clock. 24h HH:MM by default;
# for the 12h "01:35 pm" style instead use: %D{%I:%M %p}
# NOTE: color8 == color0 (#414868) in our Tokyo Night theme, so %F{8} is nearly
# invisible. Use a theme-independent 256-colour mid-grey (244) for a readable
# but understated clock.
RPROMPT='%B${vcs_info_msg_0_}%b %F{244}%D{%H:%M}%f'
