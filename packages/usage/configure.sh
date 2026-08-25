#!/bin/bash
# Prepare the collector's state and log directories, and install the systemd unit as a
# real file where one is needed.
set -euo pipefail

log() { printf '  · %s\n' "$1"; }

# ── state ───────────────────────────────────────────────────────────────────────────
# /var/lib/dot holds usage.db and the kernel's accounting file. The collector runs as
# root and writes both; `dot usage report` runs as you and only reads, hence 0755 on
# the directory and a world-readable db. The accounting file is 0600: it records every
# process every user runs, which is not something to leave readable.
if [ ! -d /var/lib/dot ]; then
  sudo install -d -m 0755 -o root -g root /var/lib/dot
  log "created /var/lib/dot"
fi

# ── log rotation ────────────────────────────────────────────────────────────────────
# svlogd reads its config from the log directory itself, which does not exist until the
# service first runs — so it has to be created here or rotation silently never applies.
# Four 1 MB files: the daemon only speaks up when a tick fails, so this is years.
if [ ! -d /var/log/runit/dot-usage ]; then
  sudo install -d -m 0755 -o root -g root /var/log/runit/dot-usage
  log "created /var/log/runit/dot-usage"
fi
if [ ! -f /var/log/runit/dot-usage/config ]; then
  printf 'n4\ns1000000\n' | sudo tee /var/log/runit/dot-usage/config >/dev/null
  log "wrote svlogd rotation config (n4, s1000000)"
fi

# ── systemd unit, as a real file ────────────────────────────────────────────────────
# Units under /etc/systemd/system are read when systemd loads units, which is before
# local-fs.target and therefore before /data is mounted. A symlink into /data resolves
# to nothing in that window and systemd treats the unit as simply absent — the silent
# failure mode AGENTS.md documents. So this package keeps its unit in etc-real/ and
# installs a copy; dot's linker structurally cannot symlink it, because collectFiles only
# walks home/ and system/.
#
# rm -f before install: install(1) onto a symlink path follows the link, which would
# overwrite the file inside /data/config/dot instead of replacing the link.
if [ -d /run/systemd/system ]; then
  src="$(dirname "$0")/etc-real/etc/systemd/system/dot-usage.service"
  if [ -f "$src" ]; then
    sudo rm -f /etc/systemd/system/dot-usage.service
    sudo install -m 0644 -o root -g root "$src" /etc/systemd/system/dot-usage.service
    sudo systemctl daemon-reload
    log "installed /etc/systemd/system/dot-usage.service (real file, not a link)"
  fi
fi

log "next: dot pkg enable usage   (runit: ln -s /etc/sv/dot-usage /var/service/)"
