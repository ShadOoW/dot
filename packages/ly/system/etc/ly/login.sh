#!/bin/sh
# Executed by ly before launching the session (login_cmd in config.ini).
# Environment variables set here persist into the session.
# Must end with exec "$@" to actually launch the session.

# Force Intel iGPU for Wayland (Nvidia is not supported)
export WLR_DRM_DEVICES=/dev/dri/by-path/pci-0000:00:02.0-card

if [ -f /etc/environment ]; then
  set -a
  . /etc/environment
  set +a
fi

exec dbus-run-session -- "$@"
