eval "$(fnm env --use-on-cd --shell zsh)"
# Only switch if a default alias actually exists — calling `fnm use default`
# with no default set has been observed to hang indefinitely instead of
# failing fast, blocking shell startup entirely.
[ -e "${FNM_DIR:-$HOME/.local/share/fnm}/aliases/default" ] && { fnm use default 2>/dev/null || true; }
eval "$(zoxide init zsh)"
eval "$(atuin init zsh)"
