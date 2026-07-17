# awsvpnclient

AWS VPN Client, managed by `dot` on both distros.

This package (`os: ["linux"]`) provides:

- **`~/.local/bin/awsvpnclient`** — a CLI launcher for the app (both distros).
  It used to carry a SAML browser workaround (see the historical note below);
  since client 5.3.1 it is a plain `exec`.
- **`system/runit/etc/sv/awsvpnclient/`** — the runit service for the root daemon
  (`ACVC.GTK.Service`). Only linked on **Void** (runit); `dot` skips it on
  systemd hosts, so on Arch it costs nothing.

The **app itself** is installed per-distro:

- **Void** — `dot` builds & installs a native xbps package from
  [`pkgbuilds/awsvpnclient/`](../../pkgbuilds/awsvpnclient/build.sh), kept current
  by `dot update source`. The runit service (above) runs the daemon.
- **Arch** — install from the AUR with `yay -S awsvpnclient`; `dot`'s `yay`
  updater (`dot update system`) keeps it current. The AUR package ships its own
  systemd service and runs `openssl fipsinstall` in its install hook.
  `dot update source` intentionally does **not** build awsvpnclient on Arch — the
  `pkgbuilds` updater is gated on `xbps-create`, which is Void-only.

## Setup

```sh
dot pkg link awsvpnclient      # links ~/.local/bin/awsvpnclient (+ runit svc on Void)
```

Void — install/update the app and enable the daemon:

```sh
dot update source              # builds & installs the awsvpnclient xbps package
sudo ln -sf /etc/sv/awsvpnclient /var/service/awsvpnclient   # or enable-runit.sh
sv status awsvpnclient         # -> run: ...
```

To take a new AWS release on Void, bump `VERSION=` (and `SHA256=`) in
`pkgbuilds/awsvpnclient/build.sh`, then re-run `dot update source`.

Arch — `yay -S awsvpnclient` then `sudo systemctl enable --now awsvpnclient`.

## Run

Launch with **`awsvpnclient`** (or the desktop entry — both work since 5.3.1),
then import your AWS VPN profile and connect. Profiles using federated (SAML)
auth open a browser login on connect; after you log in, the IdP posts the
assertion back to the client's local callback and the tunnel comes up.

## SAML browser workaround (historical, removed in 5.3.1)

Through 5.2.x the client's built-in browser launch silently no-op'd on Linux —
it made an XDG-portal / .NET call that spawned **no process at all** (confirmed
via `strace`), leaving you stuck at "Waiting for identity…". The wrapper worked
around it by polling the client log for the `SAML URL returned:` line and
opening that URL with `xdg-open`.

Client 5.3.1 opens the browser itself (the client logs `Attempting to open
browser with URL:` and it now actually spawns), so the wrapper's copy produced a
**duplicate login tab** and the workaround was removed — the wrapper is a plain
launcher now. If a future client version regresses, the polling logic is in git
history.

## Split-DNS fix (`aws-vpn-dns.service`)

The endpoint pushes its own DNS server (`dhcp-option DNS 10.4.0.2`) but no
`DOMAIN-ROUTE`, so on systemd-resolved hosts the VPN resolver competes with the
global DNS servers and usually loses. Hostnames that need split-horizon answers
(e.g. MongoDB Atlas `*.mongodb.net`: public DNS returns public IPs, the VPN
resolver returns VPC-peered private IPs) then resolve to public addresses the
tunnel does not route — connections time out even though the VPN is
"connected". macOS is unaffected (VPN DNS takes priority natively), and AWS's
`configure-dns` up-script only sets a routing domain when the server pushes
one, which ours doesn't.

`system/systemd/etc/systemd/system/aws-vpn-dns.service` binds to the `tun0`
device and runs `resolvectl domain tun0 ~mongodb.net ~eu-west-3.compute.amazonaws.com`
(+ cache flush) on every (re)connect — including SAML re-auth reconnects, which
recreate `tun0` and would wipe a manually applied fix.

**Why the second domain is required (CNAME target).** The Atlas shard hostnames
`*.mongodb.net` are **CNAMEs to `*.eu-west-3.compute.amazonaws.com`** (the
underlying EC2 instances). With only `~mongodb.net`, resolved sends the
`.mongodb.net` lookup to the VPN resolver `10.4.0.2` — which returns the correct
private A **inline** — but then **re-resolves the CNAME target
(`...compute.amazonaws.com`) in the scope that matches _it_, i.e. global Quad9**,
getting the public Atlas IP (`65.62.30.x`). The tunnel does not route those, so
Mongo times out with `ReplicaSetNoPrimary` even though the VPN is "connected"
and `~mongodb.net` is applied. Scoping the CNAME target's domain to `tun0` too
makes the whole chain resolve privately. Verify with the direct query:
`10.4.0.2` returns `10.10.0.x` for both the shard host and its `ec2-*` target;
`9.9.9.9` returns the public `65.62.30.x`.

The routing domain is deliberately scoped, **never `~.`**: a matching routing
domain beats the default-route scopes deterministically, so `*.mongodb.net` and
its EC2 CNAME target always use the VPN resolver — while every other lookup
stays on the normal DNS and keeps working when the tunnel is present but dead
(SAML re-auth windows, network switches). `~.` is actively harmful for **two**
reasons: (1) ALL DNS on the machine dies during those windows (seen as
`getaddrinfo ETIMEDOUT` everywhere — Claude Code login, browsers, etc.), and
(2) it routes the VPN's _own_ endpoint hostname
(`*.clientvpn.eu-west-3.amazonaws.com`) through `10.4.0.2`, which is only
reachable _through_ the tunnel — so once the tunnel blips it can never resolve
its endpoint to reconnect: a deadlock that shows up as a reconnect storm of
`RECONNECTING,Could not determine IPv4/IPv6 protocol` /
`RESOLVE: Cannot resolve host address ...clientvpn... (Try again)`. Note that
`clientvpn.eu-west-3.amazonaws.com` does **not** match `~eu-west-3.compute.amazonaws.com`,
so the scoped fix keeps endpoint resolution on the public resolver — no deadlock.
If another VPC-internal zone needs split-horizon answers later, append it to the
same `ExecStart` line (e.g. `~mongodb.net ~eu-west-3.compute.amazonaws.com ~internal.example.com`);
for a cluster in another region add that region's `~<region>.compute.amazonaws.com`.

```sh
dot pkg link awsvpnclient                # links the unit into /etc/systemd/system
sudo ./enable-systemd.sh                 # daemon-reload + enable (+ start if tun0 is up)
```

Diagnose with `resolvectl status tun0` (must list
`DNS Domain: ~mongodb.net ~eu-west-3.compute.amazonaws.com` while connected) and
`getent hosts <atlas-shard-host>` (must return a private `10.x`/`192.168.248.x`
address, not a public `65.62.30.x` one); `ip route get <that IP>` must show
`dev tun0`. Meanwhile `resolvectl query api.anthropic.com` must still resolve
publicly via `wlan0` (Claude login unaffected).

## Notes (Void build)

- The client-side `libe_sqlite3.so` metrics lib is intentionally blanked in the
  build (it is incompatible off-Ubuntu and would otherwise abort startup); the
  app runs fine without it. You will see harmless `e_sqlite3` / `file too short`
  errors in the logs — that is the disabled metrics recorder, not a fault.
- **`fipsmodule.cnf` generation (in `build.sh`):** before launching openvpn the
  service runs the bundled `openssl list -providers` and requires the FIPS
  provider active. `openssl.cnf` `.include`s
  `Service/Resources/openvpn/fipsmodule.cnf` (the FIPS module integrity MAC +
  self-test status), generated per-machine by `openssl fipsinstall`. Ubuntu's
  `.deb` does it in postinstall; xbps runs no postinst, so `build.sh` generates it
  (running the bundled musl `openssl` from its resources dir). It is NOT part of
  the resources the service SHA256-checksums, so adding it is safe. Without it,
  connecting fails with `UnableToEnforceFipsException` (openvpn never launches —
  PID -10). Nothing _inside_ `Service/Resources/openvpn/` may be modified (the
  service validates its checksum) — `fipsmodule.cnf` is an _added_ file.
- If the GUI fails to start on a missing library, add it to `-D` in `build.sh`
  (e.g. `icu`, `openssl`) and rebuild.
