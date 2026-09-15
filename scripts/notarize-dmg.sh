#!/bin/bash
#
# Signs, notarizes and staples the built .dmg.
#
# electron-builder notarizes and staples the .app inside the image, but leaves
# the .dmg itself unsigned. Gatekeeper then complains about the image on first
# open even though the app inside is fine. This closes that gap.
#
# Requires a notarytool keychain profile (default name "notary"):
#   xcrun notarytool store-credentials notary --apple-id <id> --team-id <team>
#
#   ./scripts/notarize-dmg.sh [path/to/file.dmg]

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="${APPLE_KEYCHAIN_PROFILE:-notary}"
DMG="${1:-$(ls -t "$ROOT"/apps/desktop/release/*.dmg 2>/dev/null | head -1)}"

if [ -z "${DMG:-}" ] || [ ! -f "$DMG" ]; then
  echo "No .dmg found. Run npm run dist:mac first." >&2
  exit 1
fi

IDENTITY="$(security find-identity -v -p codesigning | grep -o '"Developer ID Application: [^"]*"' | head -1 | tr -d '"')"
if [ -z "$IDENTITY" ]; then
  echo "No Developer ID Application certificate in the keychain." >&2
  exit 1
fi

echo "Signing   $DMG"
codesign --force --sign "$IDENTITY" --timestamp "$DMG"

echo "Notarizing (profile: $PROFILE) — usually 1–5 minutes"
xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE" --wait

echo "Stapling"
xcrun stapler staple "$DMG"

echo "Verifying"
spctl -a -vv -t open --context context:primary-signature "$DMG"
echo "Done: $DMG"
