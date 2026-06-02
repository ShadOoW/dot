#!/bin/bash
set -e

if [ "$(id -u)" = "0" ]; then
  exec sudo systemctl enable --now nix-daemon.socket
fi

sudo systemctl enable --now nix-daemon.socket
