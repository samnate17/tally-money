#!/bin/bash
# Builds glass.node for one architecture. macOS only.
#   native-glass/build.sh <arm64|x86_64> <output-dir>
set -euo pipefail
ARCH="${1:?arch}"; OUT="${2:?output dir}"
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/.." && pwd)"
NODE_INC="$(node -p "require('path').resolve(process.execPath,'../../include/node')")"
ADDON_INC="$ROOT/node_modules/node-addon-api"
[ -f "$NODE_INC/node_api.h" ] || { echo "node headers not found at $NODE_INC"; exit 1; }
[ -d "$ADDON_INC" ] || { echo "run npm ci first (node-addon-api missing)"; exit 1; }
mkdir -p "$OUT"
clang++ -std=c++17 -fobjc-arc -O2 -bundle -undefined dynamic_lookup -arch "$ARCH" -mmacosx-version-min=11.0 \
  -DNAPI_VERSION=8 -DNAPI_DISABLE_CPP_EXCEPTIONS \
  -I "$NODE_INC" -I "$ADDON_INC" -framework AppKit -framework Foundation \
  -o "$OUT/glass.node" "$HERE/glass.mm"
codesign --force --sign "${WIDGET_SIGN_IDENTITY:--}" "$OUT/glass.node"
echo "built $OUT/glass.node ($ARCH)"
