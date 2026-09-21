[[ -d "$HOME/.zsh/completions" ]] && fpath=("$HOME/.zsh/completions" $fpath)

autoload -Uz compinit
# Full compinit — which runs compaudit, the security scan over every fpath
# directory — only when the dump is missing or older than 24h; otherwise -C,
# which trusts the dump.
#
# The test HAS to expand the glob into an array, with PLAIN qualifiers. What
# stood here was `[[ -n ${...}/.zcompdump(#qN.mh+24) ]]`, wrong twice: [[ ]]
# performs no filename generation, so it tested a literal non-empty string and
# the -C branch was unreachable on every shell; and `(#q...)` is the
# in-a-normal-word form, which needs EXTENDED_GLOB — not set here, so writing
# it in a position that does glob fails with "unknown file attribute: #".
# `(Nmh-24)` is the qualifier list proper: N = no match is not an error,
# mh-24 = modified within the last 24 hours.
#
# This was worth 400 ms per shell, not a tidy-up. Measured on punk's desktop
# guest 2026-09-21, `zsh -ic true`, best of five:
#
#   /etc/zshrc's compinit + this one, full  465 ms   <- what was running
#   /etc/zshrc's compinit alone              93 ms
#   /etc/zshrc's compinit + this one, -C    107 ms   <- now
#
# So the second FULL compinit in a shell costs ~370 ms — it re-audits and
# re-scans all six fpath directories (2716 files) that the first one already
# walked — while -C, which just trusts the dump, costs ~14 ms.
#
# Do not benchmark this with `compinit -C -d /some/new/path`: -C skips the
# check for NEW completion functions, not the building of a dump that is not
# there, so pointing it at a fresh file measures a full rebuild and makes -C
# look worthless. That mismeasurement is why this comment first said the fix
# was cosmetic.
#
# The remaining duplicate is /etc/zshrc's own compinit, which punk-records
# turns off in hosts/desktop (programs.zsh.enableGlobalCompInit = false) so
# that this file is the single owner. On a machine where it is still on, the
# -C above makes the second run nearly free anyway.
typeset -ga _zcompdump_fresh=(${ZDOTDIR:-$HOME}/.zcompdump(Nmh-24))
if (($#_zcompdump_fresh)); then
  compinit -C
else
  compinit
fi
unset _zcompdump_fresh
zinit cdreplay -q
