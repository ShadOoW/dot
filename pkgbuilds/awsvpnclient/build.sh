#!/bin/bash
set -euo pipefail

PKGNAME="awsvpnclient"
VERSION="5.3.1"
ARCH="x86_64"

HOSTDIR="${1:?Usage: build.sh <hostdir>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEB_URL="https://d20adtppz83p9s.cloudfront.net/GTK/${VERSION}/awsvpnclient_amd64.deb"
# Known-good hash for this VERSION (update alongside VERSION on a bump).
SHA256="4a426cc226382748d683a4946340447dab87ec42583977d9488ee45d11cdcec0"

command -v ar >/dev/null || {
  echo "awsvpnclient: need 'ar' (binutils)" >&2
  exit 1
}
command -v zstd >/dev/null || {
  echo "awsvpnclient: need 'zstd'" >&2
  exit 1
}

STAGING=$(mktemp -d)
trap "rm -rf '$STAGING'" EXIT

echo "→ Downloading awsvpnclient ${VERSION}…"
curl -fL "$DEB_URL" -o "$STAGING/awsvpnclient.deb"
echo "${SHA256}  $STAGING/awsvpnclient.deb" | sha256sum -c -

# .deb is an `ar` archive -> extract data.tar.zst -> stage into $PKG
(cd "$STAGING" && ar x awsvpnclient.deb)
PKG="$STAGING/pkg"
mkdir -p "$PKG"
tar --zstd -xf "$STAGING"/data.tar.zst -C "$PKG"

# --- Replicate the Arch packaging fixes ---

# 1) Break the client-side metrics sqlite lib. The bundled lib is incompatible
#    off-Ubuntu; the app catches the load failure and continues. Truncate rather
#    than `chmod 000` (the Arch approach) because this build runs without
#    fakeroot, so a 000 file would be unreadable to xbps-create. An empty file
#    makes dlopen fail the same way. Leave Service/'s copy intact (daemon needs it).
: >"$PKG/opt/awsvpnclient/libe_sqlite3.so"

# 2) Ship a launcher wrapper and point the desktop entry at it. Upstream's
#    Exec uses invalid `\s` escapes for the spaces in "AWS VPN Client".
mkdir -p "$PKG/usr/local/bin"
install -m 755 "$SCRIPT_DIR/awsvpnclient.sh" "$PKG/usr/local/bin/awsvpnclient"
sed -i 's#^Exec=.*#Exec=awsvpnclient %U#' \
  "$PKG/usr/share/applications/awsvpnclient.desktop"

# 3) Generate the FIPS module config. The bundled OpenSSL FIPS provider refuses
#    to load without fipsmodule.cnf (openssl.cnf .includes it by absolute path) —
#    it holds the module integrity MAC and self-test status. Ubuntu's .deb creates
#    it in its postinstall; xbps runs no postinst, so we generate it here with the
#    bundled openssl, run from the resources dir so its relative musl interpreter
#    (ld-musl-x86_64.so.1) resolves. Without it the service's `openssl list
#    -providers` FIPS pre-check fails and connecting dies with "Unable to enforce
#    openvpn in fips mode" (openvpn is never launched). fipsmodule.cnf is machine-
#    generated (not part of the resources the service SHA256-checksums), exactly
#    as on Ubuntu.
echo "→ Generating FIPS module config (fipsinstall)…"
(cd "$PKG/opt/awsvpnclient/Service/Resources/openvpn" &&
  ./openssl fipsinstall -out ./fipsmodule.cnf -module ./fips.so) >/dev/null

# 4) License
mkdir -p "$PKG/usr/share/licenses/$PKGNAME"
ln -s /opt/awsvpnclient/Resources/LINUX-LICENSE.txt "$PKG/usr/share/licenses/$PKGNAME/"

# 5) Permission sanity (data.tar dir perms can be odd)
find "$PKG" -type d -exec chmod 755 {} +

# --- Build & install the xbps package ---
mkdir -p "$HOSTDIR"
rm -f "$HOSTDIR"/*.xbps "$HOSTDIR"/*-repodata
(cd "$HOSTDIR" && xbps-create -q -A "$ARCH" \
  -n "${PKGNAME}-${VERSION}_3" \
  -s "AWS VPN Client" \
  -D "xdg-utils>=0 lsof>=0 gtk+3>=0" \
  --license "custom" \
  --homepage "https://aws.amazon.com/vpn/" \
  "$PKG")

xbps-rindex -a "$HOSTDIR"/*.xbps
sudo xbps-install --repository="$HOSTDIR" -y "$PKGNAME"
