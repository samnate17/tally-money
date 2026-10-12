#!/bin/bash
# Builds TallyWidget.appex for one architecture. macOS only (needs Xcode command line tools).
#   native-widget/build.sh <arm64|x86_64> <output-dir> <version>
# Signs ad hoc with the sandbox entitlements. Set WIDGET_SIGN_IDENTITY to sign with a real identity instead.
set -euo pipefail
ARCH="${1:?arch}"; OUT="${2:?output dir}"; VERSION="${3:-1.0.0}"
HERE="$(cd "$(dirname "$0")" && pwd)"
APPEX="$OUT/TallyWidget.appex"
rm -rf "$APPEX"; mkdir -p "$APPEX/Contents/MacOS"
swiftc -O -parse-as-library -application-extension -module-name TallyWidget \
  -target "$ARCH-apple-macos14.0" -framework WidgetKit -framework SwiftUI \
  -Xlinker -e -Xlinker _NSExtensionMain \
  -o "$APPEX/Contents/MacOS/TallyWidget" "$HERE/TallyWidget.swift"
sed "s/__VERSION__/$VERSION/g" "$HERE/Info.plist" > "$APPEX/Contents/Info.plist"
plutil -lint "$APPEX/Contents/Info.plist" >/dev/null
codesign --force --sign "${WIDGET_SIGN_IDENTITY:--}" --entitlements "$HERE/widget.entitlements" "$APPEX"
codesign --verify --strict "$APPEX"
echo "built $APPEX ($ARCH)"
