# Export every credential in ~/.config/secrets. One file per provider, KEY=VALUE lines.
#
# The glob qualifier is `(N.)` and NOT `(N-.)`: without the `-`, `.` stats the entry itself, so
# a symlink is not a regular file and is skipped. That is the guarantee that nothing dot's linker
# publishes into this directory can enter the login environment — a template linked here would
# otherwise be sourced and export KEY= empty. `packages/secrets/configure.sh` is the other half.
# Do not add the `-` back.
if [[ -d "$HOME/.config/secrets" ]]; then
  for _sf in "$HOME/.config/secrets/"*(N.); do
    while IFS= read -r _sl || [[ -n "$_sl" ]]; do
      _sl="${_sl%$'\r'}"
      [[ "$_sl" =~ ^[[:space:]]*$ || "$_sl" =~ ^[[:space:]]*# ]] && continue
      _sk="${_sl%%=*}"
      _sv="${_sl#*=}"
      [[ "$_sk" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] && export "${_sk}"="${_sv}"
    done <"$_sf"
  done
  unset _sf _sl _sk _sv
fi
