#!/bin/sh
# Gives a built Lefi Crop Helper.app a valid ad-hoc signature and packs it in a .dmg (ADR-038).
# `tauri build` without an identity leaves only the linker's signature on the main program, with
# no sealed resources: once quarantined by a download or AirDrop, macOS calls such an app
# "damaged". An ad-hoc signature is not trusted by Gatekeeper; that needs Developer ID
# (sign-and-notarize.sh, which replaces this signature), but the bundle is then intact.
#   sh scripts/package-unsigned.sh   (from apps/helper; `pnpm bundle` runs it)
#     → src-tauri/target/release/bundle/LefiCropHelper-<version>.dmg
set -eu
HERE="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE="$HERE/src-tauri/target/release/bundle"
APP="$BUNDLE/macos/Lefi Crop Helper.app"
[ -d "$APP" ] || { echo "Build first: pnpm --filter @lefi/helper bundle" >&2; exit 1; }

# Inside out: the Lefi Desktop app in the payload, the service sidecar, then the app itself.
DESK="$APP/Contents/Resources/payload/desktop/Lefi Crop.app"
[ -d "$DESK/Contents/MacOS" ] || {
  echo "✗ This Lefi Crop Helper does not carry Lefi Desktop ($DESK). No dmg without it." >&2; exit 1; }
codesign --force --deep --sign - "$DESK"
codesign --verify --deep --strict "$DESK"
codesign --force --sign - "$APP/Contents/MacOS/lefi-helperd"
codesign --force --sign - "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"

VER="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist")"
SUFFIX=""; [ "${LEFI_HACKATHON:-0}" = 1 ] && SUFFIX="-hackathon"
DMG="$BUNDLE/LefiCropHelper-$VER$SUFFIX.dmg"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
ditto "$APP" "$STAGE/Lefi Crop Helper.app"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname "Lefi Crop Helper" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null
hdiutil verify "$DMG" >/dev/null 2>&1
echo "· Ready (ad-hoc signed, not notarised): $DMG"
