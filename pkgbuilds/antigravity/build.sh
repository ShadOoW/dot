#!/bin/bash
set -euo pipefail

PKGNAME="antigravity"
VERSION="2.1.4"
BUILD="6481382726303744"
BUILD="6481382726303744"
ARCH="x86_64"

HOSTDIR="${1:?Usage: build.sh <hostdir>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEB_URL="https://storage.googleapis.com/antigravity-public/antigravity-hub/${VERSION}-${BUILD}/linux-x64/Antigravity.tar.gz"

STAGING=$(mktemp -d)
trap "rm -rf '$STAGING'" EXIT

echo "→ Downloading antigravity ${VERSION}…"
curl -fL "$DEB_URL" -o "$STAGING/antigravity.tar.gz"

PKG="$STAGING/pkg"
mkdir -p "$PKG/opt/Antigravity-x64"
tar -xzf "$STAGING/antigravity.tar.gz" -C "$PKG/opt" --strip-components=1

mkdir -p "$PKG/usr/local/bin"
install -m 755 "$SCRIPT_DIR/antigravity.sh" "$PKG/usr/local/bin/antigravity"

mkdir -p "$PKG/usr/share/licenses/$PKGNAME"
ln -s /opt/Antigravity-x64/LICENSE.electron.txt "$PKG/usr/share/licenses/$PKGNAME/"
ln -s /opt/Antigravity-x64/LICENSES.chromium.html "$PKG/usr/share/licenses/$PKGNAME/"

mkdir -p "$PKG/usr/share/applications" "$PKG/usr/share/pixmaps"
cp "$SCRIPT_DIR/antigravity.desktop" "$PKG/usr/share/applications/"
cp "$SCRIPT_DIR/antigravity.png" "$PKG/usr/share/pixmaps/"

mkdir -p "$HOSTDIR"
echo "  Hostdir: $HOSTDIR"
rm -rf "$HOSTDIR"/*.xbps "$HOSTDIR"/*-repodata
(cd "$HOSTDIR" && xbps-create -q -A "$ARCH" \
  -n "${PKGNAME}-${VERSION}_1" \
  -s "Agentic development platform from Google" \
  --license "LicenseRef-Google-Antigravity" \
  --homepage "https://antigravity.google" \
  "$PKG")

xbps-rindex -a "$HOSTDIR"/*.xbps
sudo xbps-install --repository="$HOSTDIR" -y "$PKGNAME"
