#!/bin/bash
set -e

systemctl disable --now aws-vpn-dns.service
systemctl daemon-reload
