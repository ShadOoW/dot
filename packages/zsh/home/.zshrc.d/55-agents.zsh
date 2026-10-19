# Coding agents start inside one shared memory budget, agents.slice, where a
# host declares it (the NixOS desk: logos' `fleet/machines/desktop`, systemd.user.slices.agents).
# Everything an agent starts (vitest, browsers, tsc) stays in its scope, so when
# agents together outgrow the budget the kernel kills inside it, never Steam, a
# game or the wallpaper. Hosts without the slice run the commands unchanged.
#
# `Before=sway.service` is what keeps the desk's shutdown capture honest. That
# capture is sway.service's own ExecStop, so it runs while sway is alive — but
# every other unit is stopped in parallel during a session teardown, and a unit's
# processes die the moment its own stop job runs. An agent that is merely
# somewhere else in the tree therefore loses that race: measured 2026-10-11, six
# agent scopes were gone by 18:18:34.800 while `dot session save` was still
# reading /proc at .805, so it saved four bare terminals and armed them for the
# next login. This ordering stops the scope only after sway.service has stopped,
# i.e. after the capture has finished.
if [[ -e /etc/systemd/user/agents.slice ]]; then
  _in_agents_slice() {
    local bin
    bin=$(whence -p "$1") || {
      print -u2 "$1: command not found"
      return 127
    }
    shift
    systemd-run --user --scope --quiet --collect --slice=agents.slice \
      --property=Before=sway.service -- "$bin" "$@"
  }
  omp() { _in_agents_slice omp "$@"; }
  omp-claude() { _in_agents_slice omp-claude "$@"; }
  claude() { _in_agents_slice claude "$@"; }
  claude-account() { _in_agents_slice claude-account "$@"; }
  claude-work() { _in_agents_slice claude-work "$@"; }
  claude-personal() { _in_agents_slice claude-personal "$@"; }
fi
