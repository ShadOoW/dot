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

It also contains **`clientid ""`** instead of the stock **`duid`**, and that line is
load-bearing for DNS even though it looks like pure DHCP trivia.

`duid` generates a DUID-LLT — link-layer address **plus a creation timestamp** — and
persists it in `/var/db/dhcpcd/duid`, which lives on the root filesystem. This desktop
dual-boots, so each OS invents its own DUID and **the router sees two different clients
behind one MAC.** RouterOS matches its static lease on client-id, so whichever OS did not
create the lease falls through to a dynamic address:

```
0    address=192.168.88.10  mac=2C:33:58:12:20:B4   static, bound, last-seen 12h
     client-id="ff:…:2f:b6:2:66:52:df:f7:1d:3a:a2"   ← Arch
1  D address=192.168.88.16  mac=2C:33:58:12:20:B4   dynamic, last-seen 9m
     client-id="ff:…:31:76:b8:6e:2c:33:58:12:20:b4"  ← Void
```

`192.168.88.10` is not just an address here. It is where AdGuard answers, what the router
hands every LAN client as `dns-server=192.168.88.10`, and what every
`*.home.shadhq.com` rewrite resolves to. So on a Void boot the desktop did **not** hold
it: LAN-wide DNS silently fell back to the router (losing blocking and every `.home`
name), and `.home` names failed from this box too — resolving fine, to an address nothing
answered on. `clientid ""` sends `01:<mac>` (dhcpcd.conf(5): "a default clientid of the
hardware family and the hardware address"), which is byte-identical under both inits.

Changing the file is not enough on its own: RouterOS has already recorded the old
client-id **on** the static lease, so clear it once and drop the stray dynamic lease —

```sh
ssh admin@192.168.88.1 \
  '/ip/dhcp-server/lease/set [find where address="192.168.88.10"] client-id="";
   /ip/dhcp-server/lease/remove [find where address="192.168.88.16" and dynamic=yes]'
sudo dhcpcd -n            # re-request; both boots now ask as 01:<mac>
```

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
/etc/resolv.conf     = real static file, AdGuard first, Quad9 failover
/etc/resolvconf.conf = openresolv pointed at a scratch path, so it cannot compete
```

Both glibc (`files dns`) and musl read that one file, so there's no split brain to
begin with. **Caveat:** AWS VPN _split-DNS_ is unavailable on Void because the
client's configure-dns needs `resolvectl` (systemd-resolved). The tunnel and pushed
routes still work; only VPN-internal DNS _names_ won't resolve. (Future option: a
small `resolvectl` shim that edits resolv.conf, to unify VPN DNS on Void too.)

#### openresolv is the third writer, and it is not optional

`nohook resolv.conf` stops dhcpcd, but openresolv is a **hard dependency of `iwd`**
(`xbps-query -X openresolv` → `iwd`), so it is always installed with its stock
`/etc/resolvconf.conf`, which ships a `name_servers="…"` line. Any subscriber that
calls `resolvconf -a` then regenerates `/etc/resolv.conf` from that list and AdGuard
is silently gone. That is precisely how the box came up after the 2026-08-08 Void
reboot — `# Generated by resolvconf` / `nameserver 9.9.9.9 1.1.1.1 8.8.8.8`, every
query bypassing AdGuard, while Arch on the same disk resolved through it. dhcpcd.conf
had also drifted to a hand-added `static domain_name_servers=1.1.1.1 8.8.8.8`.
`packages/dns` therefore owns `/etc/resolvconf.conf` too and points `resolv_conf=` at
a scratch path: one authority for the file, enforced rather than assumed.

## AdGuard Home (desktop-local resolver) — live on both inits

AdGuard runs on this desktop at `127.0.0.1:53`, all interfaces (see `/data/ops/dns`),
and **both inits now resolve through it** — that is what makes ad/tracker blocking and
the local `*.home.shadhq.com` names work for this box and not just for LAN clients:

- **Arch:** `DNS=127.0.0.1`, `FallbackDNS=9.9.9.9 1.1.1.1` in
  `packages/dns/files/resolved-dns.conf`. resolv.conf stays on the stub, so
  glibc + musl + VPN-split-DNS all keep working, now via AdGuard.
- **Void:** `nameserver 127.0.0.1` first in `packages/dns/files/resolv.conf.void`.

Failover on Void is deliberately **Quad9, not the router** (`192.168.88.1`): this box
also sits on foreign Wi-Fi, where an unreachable second nameserver costs a full 5 s
libc timeout per lookup instead of failing over. AdGuard itself needs no LAN — its
upstreams are DoH with IP-literal bootstraps — so `127.0.0.1` is correct on any
network, and the only thing the failover buys is "AdGuard is down", unblocked.

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
