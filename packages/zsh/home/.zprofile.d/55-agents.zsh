# The agent wrappers are defined in .zshrc.d/55-agents.zsh, which only interactive
# shells read — and `zsh -l -c` is not interactive. That matters here because it is
# exactly how a restored terminal starts its agent: `dot session restore` writes a
# kitty session file whose launch line is `zsh -l -c '<agent> -r <id>; exec zsh -l'`.
# Without this source a RESTORED agent is launched bare — outside agents.slice, so
# the memory budget does not hold it, and with no `Before=sway.service`, so the next
# shutdown's capture races it and saves a terminal with no agent in it, which is the
# one thing a restore exists to prevent. Interactive login shells define these twice
# (here and again from .zshrc); defining a function twice is idempotent.
[[ -r "$HOME/.zshrc.d/55-agents.zsh" ]] && source "$HOME/.zshrc.d/55-agents.zsh"
