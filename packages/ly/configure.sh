#!/bin/bash
set -euo pipefail

sudo chmod +x /etc/ly/login.sh
sudo sed -i 's|^login_cmd = .*|login_cmd = /etc/ly/login.sh|' /etc/ly/config.ini
sudo mkdir -p /usr/share/xsessions

echo "ly configured."
