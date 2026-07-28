#!/bin/bash
# Enable zram under systemd.
#
# This script used to do:
#     ln -sf "$DIR/system/systemd/etc/systemd/zram-generator.conf" /etc/systemd/zram-generator.conf
# That symlink IS the bug: /data is not mounted when the generator runs, so the config read
# as absent and the machine booted with no swap for 9 days straight. configure.sh installs
# real files instead and documents the boot ordering — do not reintroduce `ln -s` here.
set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

bash "$DIR/configure.sh"
