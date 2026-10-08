# Coding agents start inside one shared memory budget, agents.slice, where a
# host declares it (the NixOS desk: egghead hosts/desktop, systemd.user.slices.agents).
# Everything an agent starts (vitest, browsers, tsc) stays in its scope, so when
# agents together outgrow the budget the kernel kills inside it, never Steam, a
# game or the wallpaper. Hosts without the slice run the commands unchanged.
if [[ -e /etc/systemd/user/agents.slice ]]; then
  _in_agents_slice() {
    local bin
    bin=$(whence -p "$1") || {
      print -u2 "$1: command not found"
      return 127
    }
    shift
    systemd-run --user --scope --quiet --collect --slice=agents.slice -- "$bin" "$@"
  }
  omp() { _in_agents_slice omp "$@"; }
  omp-claude() { _in_agents_slice omp-claude "$@"; }
  claude() { _in_agents_slice claude "$@"; }
  claude-account() { _in_agents_slice claude-account "$@"; }
  claude-work() { _in_agents_slice claude-work "$@"; }
  claude-personal() { _in_agents_slice claude-personal "$@"; }
fi
