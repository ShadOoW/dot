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

echo "== systemd-resolved / AWS VPN split-DNS =="
# Branch on the INIT, never on "is resolved running?". The old check was
#   if resolvectl exists && systemd-resolved is-active; then …; else "(Void path)"
# so on Arch a *disabled* resolved fell into the Void branch and the script printed
# ALL DNS PATHS OK — for the 13 days the AWS VPN refused every connection, because
# every ordinary lookup really did work. Distro-guard it: on Arch, no resolved is a
# hard failure. See docs/dns.md.
if [ -d /run/systemd/system ]; then
  systemctl is-enabled --quiet systemd-resolved 2>/dev/null &&
    ok "systemd-resolved enabled" ||
    bad "systemd-resolved NOT enabled — resolvectl's D-Bus activation needs the enable-time alias"
  systemctl is-active --quiet systemd-resolved 2>/dev/null &&
    ok "systemd-resolved active" || bad "systemd-resolved NOT active"

  # The load-bearing check: can resolvectl actually reach resolved? This is what the
  # AWS VPN client's configure-dns does on --up, and a non-zero exit there is FATAL to
  # OpenVPN — reported in the GUI as the thoroughly misleading "Connection failed".
  if resolvectl status >/dev/null 2>&1; then
    ok "resolvectl reaches resolved (AWS VPN configure-dns can set split-DNS)"
    resolvectl query "$CLAUDE" >/dev/null 2>&1 && ok "resolved resolves $CLAUDE" || bad "resolved FAILED"
    # Assert the upstream, do not just print it. DNS= ACCUMULATES across
    # resolved.conf and its drop-ins, so a stray `DNS=9.9.9.9` in the main file
    # silently wins over the drop-in's 127.0.0.1 and every nss-resolve lookup bypasses
    # AdGuard — no ad blocking, no *.home.shadhq.com — while every check here still
    # passed. packages/dns/files/resolved-dns.conf resets the list to prevent it.
    GLOBAL_DNS="$(resolvectl status 2>/dev/null | awk -F': ' '/^ *DNS Servers/{print $2; exit}')"
    echo "  global DNS Servers: ${GLOBAL_DNS:-<none>}"
    echo "  current upstream:   $(resolvectl status 2>/dev/null | awk -F': ' '/Current DNS Server/{print $2; exit}')"
    [ "$GLOBAL_DNS" = "127.0.0.1" ] &&
      ok "resolved upstream is AdGuard alone" ||
      bad "resolved upstream is '$GLOBAL_DNS', expected exactly '127.0.0.1' — lookups bypass AdGuard"
  else
    bad "resolvectl CANNOT reach resolved -> AWS VPN --up exits 1 -> 'Connection failed. Try again.'"
  fi

  # resolvectl working is necessary but not sufficient: if glibc skips resolved, the
  # split-DNS it installs is never consulted and VPN-internal names stay unresolvable.
  grep -qE '^hosts:.*[[:space:]]resolve([[:space:]]|$)' /etc/nsswitch.conf &&
    ok "nsswitch routes through nss-resolve (VPN split-DNS is consulted)" ||
    bad "nsswitch hosts line lacks 'resolve' — VPN connects but its split-DNS is bypassed"

  # If the AWS VPN is up, tun0 should have its pushed split-DNS server.
  if ip link show tun0 >/dev/null 2>&1; then
    resolvectl status tun0 2>/dev/null | grep -q 'DNS Servers' && ok "VPN split-DNS present on tun0" || echo "  (tun0 up but no per-link DNS)"
  fi
else
  echo "  (runit/Void — no systemd-resolved; AWS VPN split-DNS unavailable by design)"
fi

echo
[ "$FAIL" -eq 0 ] && echo "ALL DNS PATHS OK ✓" || echo "SOME CHECKS FAILED ✗"
exit $FAIL
