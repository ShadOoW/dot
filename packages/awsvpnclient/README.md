# awsvpnclient

AWS VPN Client, managed by `dot` on both distros.

This package (`os: ["linux"]`) provides:

- **`~/.local/bin/awsvpnclient`** — a launcher wrapper (both distros). The GTK
  client's built-in SAML browser launch is broken on Linux, so the wrapper opens
  the login URL itself (see _SAML browser workaround_ below).
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

Launch with **`awsvpnclient`** (the wrapper), then import your AWS VPN profile and
connect. Use the wrapper rather than the raw desktop entry — it's what opens the
SAML login page.

## SAML browser workaround

Profiles that use federated (SAML) auth need a browser login on connect. The AWS
client is supposed to open your default browser, but on Linux its launcher
silently no-ops — it makes an XDG-portal / .NET call that spawns **no process at
all** (confirmed via `strace`), so you get stuck at "Waiting for identity…". This
is an AWS client bug, identical on the AUR and Void builds; `xdg-open` itself
works fine.

The `awsvpnclient` wrapper fixes this: it polls the client log
(`~/.config/AWSVPNClient/logs/`) for the `SAML URL returned:` line and opens that
URL with `xdg-open`. After you log in, the IdP posts the assertion back to the
client's local callback and the tunnel comes up. Requires a working `xdg-open`
and a default browser (`xdg-settings get default-web-browser`).

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
