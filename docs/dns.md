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

It also contains an explicit **`clientid 00:73:61:79:6b:75:6b`** instead of the stock
**`duid`**, and that line is load-bearing for DNS even though it looks like pure DHCP
trivia. It is `0x00` + `"saykuk"`: a type-0 (not-a-hardware-address) client identifier
naming the **host**, not a NIC and not a boot.

Two identities it replaces, both of which cost this box its `.10`:

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

`clientid ""` (what this file said until 2026-08-24) was believed to send `01:<mac>`
(dhcpcd.conf(5): "a default clientid of the hardware family and the hardware address").
**It does not** — measured on the router, an empty string sends a single `0x00` byte, shown
as `client-id="0"` for _both_ NICs. That accident was host-wide, which is the only reason
the wired NIC could be rescued at all, but it was a parser artifact rather than a decision:
a dhcpcd release that "fixed" it to `01:<mac>` would silently drop the desktop off `.10`.

`192.168.88.10` is not just an address here. It is where AdGuard answers, what the router
hands every LAN client as `dns-server=192.168.88.10`, and what every
`*.home.shadhq.com` rewrite resolves to. So on a Void boot the desktop did **not** hold
it: LAN-wide DNS silently fell back to the router (losing blocking and every `.home`
name), and `.home` names failed from this box too — resolving fine, to an address nothing
answered on. The same failure appears the moment the desktop is **cabled** instead of on
Wi-Fi if the router's lease is pinned to a MAC: `enp3s0` (`04:7C:16:59:58:77`) is a
different NIC from `wlan0` (`2C:33:58:12:20:B4`), RouterOS allows only one static lease per
address, and a lease matches one MAC — so the cabled desktop lands on the dynamic pool
(observed: `192.168.88.14`). A host client-id is what makes `.10` link-agnostic.

Changing the file is not enough on its own: RouterOS has already recorded the old identity
**on** the static lease, so repin it once and drop the stray dynamic lease — the router
renews an address the client already holds, so it must be removed before the client will
ask for `.10` (config-as-code lives in `/data/config/network/mikrotik/10-baseline-dns-dhcp.rsc`):

```sh
ssh admin@192.168.88.1 \
  '/ip/dhcp-server/lease/remove [find where address="192.168.88.14"];
   /ip/dhcp-server/lease/remove [find where address="192.168.88.10"];
   /ip/dhcp-server/lease/add address=192.168.88.10 client-id="0:73:61:79:6b:75:6b" server=defconf'
sudo dhcpcd -n            # re-request; every NIC and both boots now ask as 0:73:61:79:6b:75:6b
```

⚠ **One LAN link at a time.** Both NICs present this identity, so cable + Wi-Fi up together
gets `.10` offered to both and puts one address on two interfaces in one subnet.

`/etc/dhcpcd.conf` also carries **`denyinterfaces tailscale0 wg* docker* br-* veth* tap*
podman* cni* virbr*`**, and that line exists because of a real outage, not tidiness. dhcpcd
manages every interface it finds unless told not to, so it took over `tailscale0` — an
interface whose addresses belong to `tailscaled`:

```
Aug 23 13:54:41 dhcpcd: tailscale0: using static address 100.64.0.1/32
Aug 23 13:56:27 dhcpcd: tailscale0: waiting for 3rd party to configure IP address
```

After the second line the daemon and the kernel disagree: `tailscale status` still reports
`100.64.0.1`, a listening socket is still bound to it, and `ip addr show tailscale0` carries
only the IPv6 `/128`. Headscale hands every tailnet client `A 100.64.0.1` for
`*.home.shadhq.com` (`/data/ops/headscale/extra-records.json`), so those names resolved to an
address that answered nothing — and **disconnecting** the tailnet "fixed" them, because the
phone then fell back to the AdGuard rewrite → `192.168.88.10`. A confusing shape: the LAN path
worked throughout and only tailnet clients broke.

Order matters when applying it: restart **dhcpcd first** so it releases the interface, then
`tailscaled`, which re-adds its addresses. And it must be `systemctl restart dhcpcd`, not
`dhcpcd -n` — a reload does not make dhcpcd give up an interface it already holds.

### Arch (systemd) — systemd-resolved is mandatory here

```
/etc/resolv.conf  = real file, AdGuard first  (packages/dns/files/resolv.conf.arch)
/etc/systemd/resolved.conf.d/dns.conf         DNS= / DNS=127.0.0.1, DNSStubListener=no
/etc/nsswitch.conf  hosts: mymachines resolve [!UNAVAIL=return] files myhostname dns
systemd-resolved: ENABLED (not merely started)
```

resolved cannot be dropped on Arch: the AWS VPN client's
`Service/Resources/openvpn/configure-dns` installs the VPN's pushed split-DNS **only**
via `resolvectl dns tun0 …` / `resolvectl revert tun0`, and `exit`s non-zero if that
call fails. OpenVPN treats a failed `--up` script as **fatal**, so any breakage in that
one script presents as a whole-VPN outage.

Because AdGuard owns the wildcard `:53` here, this is _not_ the stock systemd layout —
resolv.conf does **not** point at resolved's stub, and three things have to hold at once:

1. **`DNSStubListener=no`.** AdGuard binds `0.0.0.0:53`; resolved's stub (`127.0.0.53`)
   collides on TCP while UDP slips through `SO_REUSEADDR`, so AdGuard crash-loops.
2. **resolv.conf is a real file at `127.0.0.1`, not the stub symlink.** With the stub
   off, nothing answers on `127.0.0.53`, so pointing resolv.conf there is a black hole
   for every musl / c-ares client. Consequence to accept: musl clients talk to AdGuard
   directly and therefore do **not** get VPN split-DNS. Unavoidable while AdGuard holds
   the wildcard — there is no address left for resolved to listen on.
3. **`resolve` stays in the nsswitch `hosts` line.** This is what makes glibc go through
   resolved and actually _use_ the per-link DNS the VPN installs. Drop it and lookups
   fall straight through to `dns` → resolv.conf → AdGuard: the VPN connects fine and
   VPN-internal names still fail. Safe only because resolved's upstream is AdGuard, so
   nss-resolve answers still carry blocking and the `*.home.shadhq.com` names.

#### `DNS=` accumulates across drop-ins — it does not override

A drop-in that sets `DNS=127.0.0.1` does not replace a `DNS=9.9.9.9` in the main
`/etc/systemd/resolved.conf`; the lists are **merged**, and the main file's entry sorts
first. Measured here: `DNS Servers: 9.9.9.9 127.0.0.1`, `Current DNS Server: 9.9.9.9`
— resolved answering nss from Quad9 while every file on disk claimed AdGuard was the
upstream. `resolved-dns.conf` therefore resets each list with a bare `DNS=` /
`FallbackDNS=` before assigning, so the drop-in is authoritative regardless of the main
file (which `pacman -Qkk systemd` shows is hand-modified on this host) or a future
`.pacnew`. `verify.sh` asserts the resulting upstream is exactly `127.0.0.1`.

#### The 2026-08-10 outage: disabling resolved to free port 53

`/data/ops/dns`'s "Port 53 already bound" recipe ends with `rm -f /etc/resolv.conf` +
a static `nameserver 127.0.0.1`. Applied here it went one step further and left
`systemd-resolved` **disabled**, and `resolve` was separately dropped from nsswitch.
Every ordinary lookup kept working — `getent`, `curl`, `dig`, node — so nothing looked
wrong for 13 days, during which the AWS VPN refused every single connection.

The mechanism is worth knowing because the error message names nothing relevant:
`resolvectl` reaches resolved over D-Bus, and the activation file for
`org.freedesktop.resolve1` points at the **alias** `dbus-org.freedesktop.resolve1.service`.
That alias symlink is created by `systemctl enable` (the unit's `[Install] Alias=`), so a
_disabled_ resolved makes D-Bus activation fail with **`unknown unit`** — not "service
not running". `configure-dns` exits 1, OpenVPN aborts a fully established tunnel, and
the GUI says only **"Connection failed. Try again."** after a _successful_ SAML login,
which reads exactly like an ISP blocking the protocol.

So: **`enable`, never just `start`** — and never reach for `disable` to free `:53`.
`DNSStubListener=no` is the lever that frees the port; disabling the unit only breaks
the VPN. Both are now applied by `packages/dns/configure.sh` rather than by hand.

### Void (runit) — no systemd-resolved

```
/etc/resolv.conf     = real static file, AdGuard first, Quad9 failover
/etc/resolvconf.conf = openresolv pointed at a scratch path, so it cannot compete
```

Both glibc (`files dns`) and musl read that one file, so there's no split brain to
begin with.

> **Caveat — stronger than it used to read here.** This file previously claimed that on
> Void "the tunnel and pushed routes still work; only VPN-internal DNS names won't
> resolve." **That is false.** `configure-dns`'s `call_resolvectl` does `exit $exit_code`
> on any non-zero result, and a missing `resolvectl` exits **127** — measured, by running
> the real script with a PATH that has everything except `resolvectl`:
>
> ```
> --up exit code with resolvectl ABSENT: 127
> ```
>
> OpenVPN treats a non-zero `--up` as fatal (`F,WARNING: Failed running command
(--up/--down)`), so on Void the AWS VPN **cannot connect at all** — it fails the same
> way, and with the same misleading "Connection failed. Try again.", as the Arch outage
> documented above. It is not a degraded-DNS caveat; it is a hard blocker.
>
> Unfixed as of 2026-08-23, because it is unverifiable from the Arch boot. The fix is the
> `resolvectl` shim floated below, and it needs testing _on_ Void.

A shim is the only route to VPN DNS on Void, but note it collides with this package's
central invariant — **one authority for `/etc/resolv.conf`** (see openresolv below). A
shim that rewrites resolv.conf becomes a second writer, so it must either write through
the same static file this package owns, or the invariant has to be restated to name the
shim as the exception. Decide that before writing it.

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
  `packages/dns/files/resolved-dns.conf` — each preceded by a list-resetting bare
  assignment, or the main `resolved.conf`'s own `DNS=` wins (see above). glibc reaches
  AdGuard _through_ resolved (nss-resolve), which is what preserves VPN split-DNS;
  musl/c-ares reaches it directly via the real `/etc/resolv.conf`. resolv.conf is
  **not** on resolved's stub here — `DNSStubListener=no` is required so AdGuard can
  bind the wildcard `:53`.
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
