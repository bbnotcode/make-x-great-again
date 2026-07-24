#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXTENSION_DIR="$ROOT/extension"
PROJECT="$ROOT/apple/MXGA/MXGA.xcodeproj"
DERIVED_DATA="${DERIVED_DATA_PATH:-$ROOT/.build/safari-ios}"

for candidate in /opt/homebrew/bin /usr/local/bin; do
  if [[ -d "$candidate" ]]; then
    export PATH="$candidate:$PATH"
  fi
done

if ! command -v npm >/dev/null 2>&1; then
  echo "error: npm is required (Node.js 20 or newer)." >&2
  exit 1
fi
if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "error: Xcode is required." >&2
  exit 1
fi
if [[ ! -d "$EXTENSION_DIR/node_modules" ]]; then
  echo "error: extension dependencies are missing; run 'npm --prefix extension install'." >&2
  exit 1
fi

if [[ -z "${DEVELOPER_DIR:-}" && -d /Applications/Xcode.app/Contents/Developer ]]; then
  export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
fi

npm --prefix "$EXTENSION_DIR" run build:safari

configuration="${CONFIGURATION:-Debug}"
destination="${DESTINATION:-generic/platform=iOS Simulator}"

xcodebuild \
  -project "$PROJECT" \
  -scheme "MXGA (iOS)" \
  -configuration "$configuration" \
  -destination "$destination" \
  -derivedDataPath "$DERIVED_DATA" \
  CODE_SIGNING_ALLOWED=NO \
  build

app="$DERIVED_DATA/Build/Products/${configuration}-iphonesimulator/MXGA.app"
if [[ ! -d "$app" ]]; then
  echo "error: expected simulator product does not exist: $app" >&2
  exit 1
fi

echo
echo "Built iOS simulator app: $app"
