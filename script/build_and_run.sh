#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="Qx"
APP_PROCESS="qx"
APP_BUNDLE="$ROOT/src-tauri/target/release/bundle/macos/$APP_NAME.app"

cd "$ROOT"

pkill -x "$APP_PROCESS" 2>/dev/null || true

npm run tauri build

if [[ ! -d "$APP_BUNDLE" ]]; then
  echo "App bundle not found: $APP_BUNDLE" >&2
  exit 1
fi

/usr/bin/open -n "$APP_BUNDLE"

if [[ "${1:-}" == "--verify" ]]; then
  sleep 2
  pgrep -x "$APP_PROCESS" >/dev/null
  echo "$APP_NAME is running"
fi
