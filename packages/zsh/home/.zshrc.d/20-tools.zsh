eval "$(fnm env --use-on-cd --shell zsh)"
# Only switch if a default alias actually exists — calling `fnm use default`
# with no default set has been observed to hang indefinitely instead of
# failing fast, blocking shell startup entirely.
[ -e "${FNM_DIR:-$HOME/.local/share/fnm}/aliases/default" ] && { fnm use default 2>/dev/null || true; }
eval "$(zoxide init zsh)"
eval "$(atuin init zsh)"
# `atuin init zsh` sets ZSH_AUTOSUGGEST_STRATEGY=(atuin) — one strategy, and a
# single point of failure for the inline hint. When the atuin binary cannot open
# its database it prints nothing to the shell and simply returns no suggestion:
#
#   Error: migration 20260818000000 was previously applied but is missing in the
#          resolved migrations
#
# which is what a db migrated by a newer atuin than the one on PATH looks like
# (packages/atuin/README.md; it happened on Void in August and again on the
# NixOS desktop, whose nixpkgs caps at 18.15.2 against a schema written by
# 18.2x). The symptom is no hint at all, which reads as "zsh-autosuggestions is
# not loading" and sends the search to the wrong place every time.
#
# zsh-autosuggestions takes a LIST and uses the first strategy that returns
# something, so naming the fallbacks costs nothing while atuin works and keeps
# the hint alive when it does not. `history` is zsh's own $HISTFILE, which is
# still being written; `completion` is what the completion system would insert.
ZSH_AUTOSUGGEST_STRATEGY=(atuin history completion)
