# dns

Makes `/etc/resolv.conf` always valid and **restore-proof**, on both Arch (systemd)
and Void (runit), and stops dhcpcd from clobbering it. This is the permanent fix for
the class of breakage where a restore left DNS resolution silently broken for
`musl`/`c-ares` apps (the bundled AWS VPN openvpn, Claude Code) while glibc apps kept
working. Full rationale + diagrams in [`docs/dns.md`](../../docs/dns.md).

Configure-driven (not a link package). Run:

```sh
dot pkg dns configure      # writes the /etc files, enables resolved on Arch
bash packages/dns/verify.sh   # triple-checks libc + c-ares paths (VPN/Claude/internet)
```

## What it does

- **Both distros:** installs `/etc/dhcpcd.conf` with **`nohook resolv.conf`** as a
  real file. The MikroTik hands out no DNS over DHCP, so dhcpcd's resolv.conf hook
  would otherwise write an **empty** resolv.conf on every lease — the root cause.
- **Arch (systemd):** `/etc/resolv.conf` as a **real file at AdGuard** (`127.0.0.1`),
  _not_ resolved's stub — AdGuard owns the wildcard `:53`, so resolved runs with
  `DNSStubListener=no` and nothing answers on `127.0.0.53`. resolved is **enabled**
  (not merely started), its upstream is AdGuard via `resolved.conf.d/dns.conf`, and
  `resolve` is kept in the `nsswitch.conf` hosts line. All three are required: the AWS
  VPN client sets split-DNS only via `resolvectl` (so resolved must be _enabled_, or
  D-Bus activation fails with `unknown unit`), and only nss-resolve actually _uses_
  that split-DNS.
- **Void (runit):** a real static `/etc/resolv.conf` (**AdGuard** first, Quad9
  failover), which both glibc and musl read, **plus** `/etc/resolvconf.conf` pointing
  openresolv at a scratch path so it cannot regenerate the file behind you. VPN
  split-DNS is unavailable on Void (client needs `resolvectl`); the tunnel + routes
  still work.

## Why real files, not dot symlinks

The original breakage was `/etc/dhcpcd.conf` being a **symlink into a dotfiles tree
that had moved**, so dhcpcd fell back to defaults and re-enabled its resolv.conf
hook. Network-critical files are therefore installed as real files by `configure.sh`,
not linked into the repo — they survive the repo being absent/moved.

## AdGuard Home — live on both inits

AdGuard (desktop-local, `127.0.0.1:53`, `/data/ops/dns`) is what this box resolves
through under **both** inits. Failover is a public resolver, not the router, because
this desktop also sits on foreign Wi-Fi where an unreachable nameserver costs a 5 s
libc timeout per lookup. Rationale and the openresolv trap that bypassed AdGuard for
the whole 2026-08-08 Void boot: [`docs/dns.md`](../../docs/dns.md).

## Files

- `files/dhcpcd.conf` → `/etc/dhcpcd.conf` (both)
- `files/resolved-dns.conf` → `/etc/systemd/resolved.conf.d/dns.conf` (Arch; upstream
  **and** `DNSStubListener=no`. Each list is reset with a bare `DNS=` first — drop-ins
  _accumulate_ with the main `resolved.conf` instead of overriding it)
- `files/resolv.conf.arch` → `/etc/resolv.conf` (Arch; real file, AdGuard first)
- `files/resolv.conf.void` → `/etc/resolv.conf` (Void)
- `files/resolvconf.conf.void` → `/etc/resolvconf.conf` (Void; openresolv can't own resolv.conf)
- `configure.sh` — detects init, installs the above, enables resolved + keeps
  `resolve` in nsswitch on Arch
- `verify.sh` — checks libc + c-ares resolution for internet / Claude / VPN-endpoint,
  and on Arch hard-fails if resolved is disabled, unreachable via `resolvectl`, not
  upstreamed to AdGuard, or missing from nsswitch
