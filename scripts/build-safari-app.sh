#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXTENSION_DIR="$ROOT/extension"
PROJECT="$ROOT/apple/MXGA/MXGA.xcodeproj"
DERIVED_DATA="${DERIVED_DATA_PATH:-$ROOT/.build/safari}"

# Non-interactive shells on Apple Silicon often omit Homebrew from PATH.
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

# Prefer the stable Xcode installation for reproducible App Store builds.
if [[ -z "${DEVELOPER_DIR:-}" && -d /Applications/Xcode.app/Contents/Developer ]]; then
  export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
fi

npm --prefix "$EXTENSION_DIR" run build:safari

configuration="${CONFIGURATION:-Debug}"
development_team="${DEVELOPMENT_TEAM:-}"
local_signing_config="$ROOT/apple/Config/Signing.local.xcconfig"
if [[ -z "$development_team" && -f "$local_signing_config" ]]; then
  development_team="$(
    sed -nE 's/^[[:space:]]*DEVELOPMENT_TEAM[[:space:]]*=[[:space:]]*([A-Za-z0-9]+).*$/\1/p' \
      "$local_signing_config" | tail -n 1
  )"
fi
if [[ -n "$development_team" ]]; then
  signing="${CODE_SIGNING_ALLOWED:-YES}"
else
  signing="${CODE_SIGNING_ALLOWED:-NO}"
fi

build_args=(
  -project "$PROJECT"
  -scheme "MXGA (macOS)"
  -configuration "$configuration"
  -destination "platform=macOS"
  -derivedDataPath "$DERIVED_DATA"
  "CODE_SIGNING_ALLOWED=$signing"
)
if [[ -n "$development_team" ]]; then
  build_args+=("DEVELOPMENT_TEAM=$development_team")
fi
if [[ "${ALLOW_PROVISIONING_UPDATES:-0}" == "1" ]]; then
  build_args+=(-allowProvisioningUpdates)
fi

xcodebuild "${build_args[@]}" build

app="$DERIVED_DATA/Build/Products/$configuration/MXGA.app"
if [[ ! -d "$app" ]]; then
  echo "error: expected build product does not exist: $app" >&2
  exit 1
fi

echo
echo "Built app: $app"
if [[ "$signing" != "YES" ]]; then
  echo "warning: this is an unsigned/ad-hoc build; Safari cannot manage its extension." >&2
  echo "         Rebuild with DEVELOPMENT_TEAM=<team-id> before installing." >&2
fi

if [[ "${INSTALL_APP:-0}" == "1" ]]; then
  team_identifier="$(codesign -dv --verbose=4 "$app" 2>&1 | sed -n 's/^TeamIdentifier=//p')"
  if [[ -z "$team_identifier" || "$team_identifier" == "not set" ]]; then
    echo "error: INSTALL_APP=1 requires a development-signed build." >&2
    echo "       Set DEVELOPMENT_TEAM=<team-id> and rebuild." >&2
    exit 1
  fi

  destination="${INSTALL_DESTINATION:-/Applications/MXGA.app}"
  pkill -x MXGA 2>/dev/null || true
  rm -rf "$destination"
  ditto "$app" "$destination"
  codesign --verify --deep --strict --verbose=2 "$destination"
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
    -f "$destination"
  pluginkit -a "$destination/Contents/PlugIns/MXGA Extension.appex"
  echo "Installed app: $destination"

  if [[ "${OPEN_APP:-1}" == "1" ]]; then
    open -n "$destination"
  fi
fi
