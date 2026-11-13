#!/bin/sh
# Signs, notarises and staples Lefi Crop Helper.app and its .dmg (ADR-026 Q3, ADR-035).
# NOT RUN YET: it needs, on this Mac, the owner's
#   1. "Developer ID Application: …" certificate in the login keychain
#      (developer.apple.com → Certificates; check: security find-identity -v -p codesigning)
#   2. notarisation credentials stored once:
#      xcrun notarytool store-credentials lefi --apple-id <id> --team-id <TEAM> --password <app-specific>
# Usage (from apps/helper, after `pnpm bundle`):
#   sh scripts/sign-and-notarize.sh            → target/release/bundle/LefiCropHelper-<version>.dmg
set -eu
HERE="$(cd "$(dirname "$0")/.." && pwd)"
APP="$HERE/src-tauri/target/release/bundle/macos/Lefi Crop Helper.app"
PROFILE="${NOTARY_PROFILE:-lefi}"
[ -d "$APP" ] || { echo "Build first: pnpm --filter @lefi/helper bundle" >&2; exit 1; }

ID="$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | head -n1)"
[ -n "$ID" ] || { echo "No 'Developer ID Application' certificate in the keychain (only Apple Development found?)." >&2; exit 1; }
echo "· Signing with: $ID"

sign() { codesign --force --timestamp --options runtime --sign "$ID" "$@"; }
# Inside out: the Lefi Desktop app in the payload, the service sidecar, then the app itself.
DESK="$APP/Contents/Resources/payload/desktop/Lefi Crop.app"
[ -d "$DESK" ] && sign --deep "$DESK"
sign "$APP/Contents/MacOS/lefi-helperd"
sign "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"

VER="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist")"
DMG="$HERE/src-tauri/target/release/bundle/LefiCropHelper-$VER.dmg"
rm -f "$DMG"
hdiutil create -volname "Lefi Crop Helper" -srcfolder "$APP" -ov -format UDZO "$DMG"
sign "$DMG"

echo "· Notarising (Apple service, a few minutes)"
xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE" --wait
xcrun stapler staple "$DMG"
xcrun stapler staple "$APP"
spctl --assess --type open --context context:primary-signature -v "$DMG"
spctl --assess --type execute -v "$APP"
echo "· Ready: $DMG"
