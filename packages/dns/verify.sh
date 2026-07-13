#!/bin/bash
# packages/dns — triple-check that DNS works for EVERY resolver path at once:
#   - libc / nss (getent)         : browsers, curl, most system tools
#   - c-ares / musl (node resolve): the AWS bundled openvpn + Claude Code runtime —
#                                   the path that reads /etc/resolv.conf directly and
#                                   was the actual breakage. node dns.resolve4() uses
#                                   c-ares, exactly like the broken apps (unlike
#                                   dns.lookup()/getent which use libc/nss).
# Exits non-zero if any critical check fails. Safe/read-only. See docs/dns.md.
set -u
FAIL=0
ok() { echo "  ✓ $1"; }
bad() {
  echo "  ✗ $1"
  FAIL=1
}

# Names: internet, Claude login, and a *random-prefixed* AWS Client VPN endpoint
# (AWS uses a fresh subdomain per connect — this is what the bundled openvpn must
# resolve BEFORE the tunnel exists).
INTERNET="example.com"
CLAUDE="platform.claude.com"
VPN="probe$RANDOM.cvpn-endpoint-05197b0b3658b1069.prod.clientvpn.eu-west-3.amazonaws.com"

echo "== resolv.conf =="
if [ -L /etc/resolv.conf ]; then echo "  /etc/resolv.conf -> $(readlink /etc/resolv.conf)"; fi
grep -E '^nameserver' /etc/resolv.conf >/dev/null 2>&1 && ok "has a nameserver" || bad "NO nameserver in resolv.conf"

echo "== libc / nss path (getent — browsers, curl) =="
for n in "$INTERNET" "$CLAUDE" "$VPN"; do
  getent hosts "$n" >/dev/null 2>&1 && ok "getent $n" || bad "getent $n FAILED"
done

echo "== c-ares path (node dns.resolve — AWS openvpn / Claude Code style) =="
NODE="$(command -v node || true)"
if [ -n "$NODE" ]; then
  for n in "$INTERNET" "$CLAUDE" "$VPN"; do
    "$NODE" -e 'require("dns").resolve4(process.argv[1],(e,r)=>{if(e){console.error(e.code||e.message);process.exit(1)}process.exit(0)})' "$n" >/dev/null 2>&1 &&
      ok "c-ares $n" || bad "c-ares $n FAILED (this is the path that broke)"
  done
else
  echo "  (node not found — skipping c-ares check)"
fi

echo "== systemd-resolved (Arch only) =="
if command -v resolvectl >/dev/null 2>&1 && systemctl is-active --quiet systemd-resolved 2>/dev/null; then
  resolvectl query "$CLAUDE" >/dev/null 2>&1 && ok "resolved resolves $CLAUDE" || bad "resolved FAILED"
  echo "  upstream: $(resolvectl status 2>/dev/null | awk -F': ' '/Current DNS Server/{print $2; exit}')"
  # If the AWS VPN is up, tun0 should have its pushed split-DNS server.
  if ip link show tun0 >/dev/null 2>&1; then
    resolvectl status tun0 2>/dev/null | grep -q 'DNS Servers' && ok "VPN split-DNS present on tun0" || echo "  (tun0 up but no per-link DNS)"
  fi
else
  echo "  (no systemd-resolved — Void path)"
fi

echo
[ "$FAIL" -eq 0 ] && echo "ALL DNS PATHS OK ✓" || echo "SOME CHECKS FAILED ✗"
exit $FAIL
