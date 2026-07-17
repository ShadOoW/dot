#!/bin/bash
set -e

systemctl daemon-reload
systemctl enable aws-vpn-dns.service
# Apply immediately when the tunnel is already up; otherwise the tun0 device
# unit triggers the service on the next connect.
if ip link show tun0 &>/dev/null; then
  systemctl restart aws-vpn-dns.service
fi
