#!/bin/bash
set -e

if [ "$(id -u)" = "0" ]; then
  exec su - shad -c "bash $0"
fi

export XDG_RUNTIME_DIR="/run/user/$(id -u)"
export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$(id -u)/bus"
systemctl --user disable --now agentmemory.service
