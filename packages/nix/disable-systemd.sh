#!/bin/bash
set -e

if [ "$(id -u)" = "0" ]; then
  exec sudo systemctl disable --now nix-daemon.socket
fi

sudo systemctl disable --now nix-daemon.socket
