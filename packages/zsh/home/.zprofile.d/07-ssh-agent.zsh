_setup_ssh_agent() {
  eval "$(ssh-agent -s)" >/dev/null 2>&1
  local key=~/.ssh/id_github
  [[ -f "$key" ]] || return
  if [[ "$_DISTRO" == "macos" ]]; then
    ssh-add --apple-use-keychain "$key" 2>/dev/null
  else
    ssh-add "$key" 2>/dev/null
  fi
}

# Must run before .zshrc.d/00-zinit.zsh: on a fresh cache (e.g. after a
# system restore), zinit has to git-clone itself and its plugins from
# github.com over ssh (~/.gitconfig rewrites https -> ssh for github), so
# the agent/key need to be ready before that file sources zinit.zsh.
[[ -z "$SSH_AUTH_SOCK" ]] && _setup_ssh_agent
