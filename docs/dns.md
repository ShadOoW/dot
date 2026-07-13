# DNS on this desktop (Arch + Void)

How name resolution is set up, why it's shaped this way, and the failure mode that
motivated it. Managed by [`packages/dns`](../packages/dns/). This is the same
physical desktop dual-booting **Arch (systemd)** and **Void (runit)**.

## The failure that started this

After a backup restore, two unrelated-looking things broke at once:

- the **AWS VPN Client** could never connect ("Waiting for identity…"), and
- **Claude Code login** failed with `getaddrinfo ETIMEOUT platform.claude.com`.

Every ordinary check passed — `getent hosts`, `curl`, and system `node` all resolved
fine — which made it look like nothing was wrong. Root cause:

1. The restore left `/etc/dhcpcd.conf` as a **dangling symlink** into an old dotfiles
   path that no longer existed. dhcpcd fell back to its defaults, which include the
   `resolv.conf` hook.
2. The MikroTik router hands out **no DNS server** over DHCP (by design — DNS is
   provided locally). So dhcpcd's hook wrote an **empty** `/etc/resolv.conf` (zero
   `nameserver` lines) on every lease event, repeatedly.

### Why it was invisible: the glibc-vs-musl split brain

`/etc/nsswitch.conf` here is:

```
hosts: mymachines resolve [!UNAVAIL=return] files myhostname dns
```

- **glibc** apps (getent, curl, browsers, system node's `dns.lookup`) hit `resolve`
  → talk to **systemd-resolved** directly over varlink → **never read
  `/etc/resolv.conf`** → kept working.
- **musl / c-ares** resolvers read **`/etc/resolv.conf` directly**. With no
  `nameserver`, they had nothing to query → timeout. This is the path used by the
  **AWS bundled openvpn** (musl) and **Claude Code's runtime** (c-ares), and by
  `node dns.resolve4()`. Hence VPN + Claude broke while everything else looked fine.

The stub resolver itself was healthy the whole time (`127.0.0.53:53` answered in
0 ms) — only `resolv.conf` pointed nothing at it.

## The fix / current architecture

Principle: **a local stub resolver owns DNS; `/etc/resolv.conf` always points at a
working nameserver; dhcpcd never touches it.** Implemented cross-distro by
`packages/dns` (see its README). Network-critical files are installed as **real
files** (not symlinks into the repo) — a symlink into a moved/absent repo is exactly
what broke.

### Both distros

`/etc/dhcpcd.conf` contains **`nohook resolv.conf`** → dhcpcd never manages DNS.

### Arch (systemd) — systemd-resolved is mandatory here

```
/etc/resolv.conf → /run/systemd/resolve/stub-resolv.conf   (nameserver 127.0.0.53)
systemd-resolved upstream: /etc/systemd/resolved.conf.d/dns.conf  (DNS=9.9.9.9)
```

resolv.conf → the resolved stub means glibc (nss-resolve) **and** musl/c-ares (via
the stub) both go through resolved → **no split brain**. resolved cannot be dropped
on Arch: the AWS VPN client's `Service/Resources/openvpn/configure-dns` sets the
VPN's pushed split-DNS **only** via `resolvectl dns tun0 …` / `resolvectl revert
tun0`, and `exit`s non-zero if `resolvectl` is missing.

### Void (runit) — no systemd-resolved

```
/etc/resolv.conf  = real static file (nameserver 192.168.88.1, the router)
```

Both glibc (`files dns`) and musl read this one file, so there's no split brain to
begin with. **Caveat:** AWS VPN _split-DNS_ is unavailable on Void because the
client's configure-dns needs `resolvectl` (systemd-resolved). The tunnel and pushed
routes still work; only VPN-internal DNS _names_ won't resolve. (Future option: a
small `resolvectl` shim that edits resolv.conf, to unify VPN DNS on Void too.)

## AdGuard Home (desktop-local resolver) — the one-line flip

AdGuard runs (or will) on this desktop at `127.0.0.1:53`, all interfaces
(see `/data/ops/dns`). It is **scaffolded but not enabled**, so DNS currently goes
Quad9-direct — AdGuard is bypassed. Do **not** point at AdGuard while it's down:
that gives no benefit and risks slow/broken resolution. Once AdGuard is up and
answering:

- **Arch:** set `DNS=127.0.0.1 9.9.9.9` in `packages/dns/files/resolved-dns.conf`,
  `dot pkg dns configure`, `sudo systemctl restart systemd-resolved`. resolv.conf
  stays on the stub, so glibc+musl+VPN-split-DNS all keep working, now via AdGuard.
- **Void:** uncomment `nameserver 127.0.0.1` (first line) in
  `packages/dns/files/resolv.conf.void`, `dot pkg dns configure`.

Related: router hands DHCP clients `dns-server=192.168.88.10,192.168.88.1` (see
`/data/config/network`); AdGuard upstreams are DoH Quad9/Cloudflare (`/data/ops/dns`).

## Verifying everything at once

`bash packages/dns/verify.sh` checks resolution over **both** resolver paths — libc
(`getent`, the path that stayed working) and **c-ares** (`node dns.resolve4`, the
path that broke, same as the AWS openvpn / Claude Code) — for the internet, Claude,
and a random-prefixed AWS VPN endpoint. If the VPN is up it also confirms `tun0`
per-link split-DNS. All green = VPN + Claude + internet all resolve simultaneously.

## Wi-Fi (iwd) interaction

Wireless is `iwd` + `dhcpcd`: iwd handles the wireless link, dhcpcd handles DHCP.
Keep iwd out of DNS/IP config so it doesn't fight this setup — `/etc/iwd/main.conf`:

```
[General]
EnableNetworkConfiguration=false
```

Note this reverses the old `packages/dhcpcd` comment ("dhcpcd provides DNS"): with
`nohook resolv.conf`, dhcpcd no longer manages DNS at all — DNS comes from
systemd-resolved (Arch) or the static resolv.conf (Void).

## Known caveat: no IPv6 on this host

Only a link-local `fe80::/64` route exists; there is no global IPv6. DNS still
returns AAAA records (e.g. `platform.claude.com → 2607:6bc0::10`). Happy-Eyeballs
clients (curl, node, browsers) fall back to IPv4 fine; a non-Happy-Eyeballs client
could stall ~5 s on the dead IPv6. If that ever bites, suppress AAAA at AdGuard or
set IPv4 precedence in `/etc/gai.conf`. Not currently a problem, so left alone.
