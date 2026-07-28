#!/bin/bash
# Deactivate zram and remove the config that configure.sh installed.
# `unlink` was correct while enable-systemd.sh created a symlink; the config is a real file
# now (see configure.sh for why), so use rm -f and tolerate it already being absent.
set -e

swapoff /dev/zram0 2>/dev/null || true
systemctl stop dev-zram0.swap 2>/dev/null || true
rm -f /etc/systemd/zram-generator.conf
rm -f /etc/modules-load.d/zram.conf
systemctl daemon-reload
