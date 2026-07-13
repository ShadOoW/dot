#!/bin/bash
# packages/dns — make /etc/resolv.conf always valid and restore-proof, cross-distro.
# Run: dot pkg dns configure   (or: dot configure dns). Needs sudo (primed by dot).
# See docs/dns.md for the full rationale.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# init is the distro proxy here: systemd => Arch, runit => Void.
if [ -d /run/systemd ]; then
  INIT=systemd
elif [ -d /run/runit ]; then
  INIT=runit
else INIT="$(ps -p 1 -o comm= | tr -d ' ')"; fi
echo "→ detected init: $INIT"

# 1) BOTH distros: stop dhcpcd from clobbering resolv.conf. Written as a REAL file,
#    not a symlink into the repo — a dangling symlink into a moved/absent dotfiles
#    tree is exactly what broke DNS after the restore. See docs/dns.md.
sudo install -m 644 "$DIR/files/dhcpcd.conf" /etc/dhcpcd.conf
echo "✓ /etc/dhcpcd.conf (nohook resolv.conf)"

if [ "$INIT" = systemd ]; then
  # 2a) Arch: systemd-resolved is the single DNS front-end. It is MANDATORY here —
  #     the AWS VPN client's configure-dns sets split-DNS only via resolvectl. With
  #     resolv.conf -> resolved's stub, glibc (nss-resolve) AND musl/c-ares (stub
  #     127.0.0.53) both go through resolved, so there is no split-brain.
  sudo mkdir -p /etc/systemd/resolved.conf.d
  sudo install -m 644 "$DIR/files/resolved-dns.conf" /etc/systemd/resolved.conf.d/dns.conf
  sudo systemctl enable --now systemd-resolved
  sudo ln -sf /run/systemd/resolve/stub-resolv.conf /etc/resolv.conf
  sudo systemctl restart systemd-resolved
  echo "✓ resolv.conf -> systemd-resolved stub (127.0.0.53); upstream via resolved.conf.d/dns.conf"
else
  # 2b) Void (runit): no systemd-resolved. Ship a REAL static resolv.conf that both
  #     glibc (files dns) and musl read. NOTE: AWS VPN split-DNS is unavailable on
  #     Void — the client's configure-dns needs resolvectl. See docs/dns.md.
  sudo install -m 644 "$DIR/files/resolv.conf.void" /etc/resolv.conf
  echo "✓ /etc/resolv.conf (static)"
fi

# 3) Re-apply dhcpcd so it drops the resolv.conf hook now.
if [ "$INIT" = systemd ]; then
  systemctl is-active --quiet dhcpcd 2>/dev/null && sudo systemctl restart dhcpcd || true
elif [ "$INIT" = runit ]; then
  [ -e /var/service/dhcpcd ] && sudo sv restart dhcpcd || true
fi

echo "✓ dns configured ($INIT). Verify with: bash $DIR/verify.sh"
