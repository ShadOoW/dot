#!/bin/bash
# packages/dns — make /etc/resolv.conf always valid and restore-proof, cross-distro.
# Run: dot pkg dns configure   (or: dot configure dns). Needs sudo (primed by dot).
# See docs/dns.md for the full rationale.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# init is the distro proxy here: systemd => Arch, runit => Void.
# /run/systemd/system, not /run/systemd: elogind creates the latter on Void for the logind
# API, so the bare check made Void take the systemd-resolved branch below — which would have
# enabled a unit that does not exist and repointed /etc/resolv.conf at a systemd stub path
# that is never populated, i.e. no DNS. See packages/zram/configure.sh for the write-up.
if [ -d /run/systemd/system ]; then
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
  #     openresolv rides in as an iwd dependency and its stock config claims
  #     resolv.conf, so point it at a scratch path first — otherwise the next
  #     `resolvconf -a` overwrites the file we are about to install.
  sudo install -m 644 "$DIR/files/resolvconf.conf.void" /etc/resolvconf.conf
  sudo install -m 644 "$DIR/files/resolv.conf.void" /etc/resolv.conf
  echo "✓ /etc/resolvconf.conf (resolvconf cannot own resolv.conf)"
  echo "✓ /etc/resolv.conf (static, AdGuard first)"
fi

# 3) Make the running dhcpcd re-read its config so `nohook resolv.conf` takes effect now
#    rather than at the next lease. RELOAD, never restart: dhcpcd deconfigures the
#    interface on the way down, so a restart drops the address and the default route for
#    a second or two. That is not theoretical — the 2026-08-08 run of this script killed
#    an in-flight ssh session ("No route to host" to a host with 66 days uptime) and timed
#    out a cloudflared API call, and on runit `sv restart` additionally hung for its full
#    7s timeout because dhcpcd does not die promptly. `dhcpcd -n` reloads the
#    configuration and rebinds without tearing the interface down, on both inits.
if pgrep -x dhcpcd >/dev/null 2>&1; then
  sudo dhcpcd -n >/dev/null 2>&1 && echo "✓ dhcpcd reloaded (lease kept)" ||
    echo "! dhcpcd reload failed — nohook applies at the next lease"
else
  echo "· dhcpcd not running — nothing to reload"
fi

echo "✓ dns configured ($INIT). Verify with: bash $DIR/verify.sh"
