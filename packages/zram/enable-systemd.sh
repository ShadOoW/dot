#!/bin/bash
set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ln -sf "$DIR/system/systemd/etc/systemd/zram-generator.conf" /etc/systemd/zram-generator.conf
systemctl daemon-reload
systemctl start systemd-zram-setup@zram0.service
