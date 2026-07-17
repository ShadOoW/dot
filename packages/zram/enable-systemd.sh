#!/bin/bash
set -e

ln -sf /data/config/dot/packages/zram/system/systemd/etc/systemd/zram-generator.conf /etc/systemd/zram-generator.conf
systemctl daemon-reload
systemctl start systemd-zram-setup@zram0.service
