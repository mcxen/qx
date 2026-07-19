#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="Qx"
APP_PROCESS="qx"
APP_BUNDLE="$ROOT/src-tauri/target/release/bundle/macos/$APP_NAME.app"
MODE="${1:---dev}"

cd "$ROOT"

pkill -x "$APP_PROCESS" 2>/dev/null || true

run_dev() {
  npm run tauri dev
}

case "$MODE" in
  run|--dev|dev)
    exec npm run tauri dev
    ;;
  --debug|debug)
    export RUST_BACKTRACE=1
    export RUST_LOG="qx=debug,tauri=info"
    exec npm run tauri dev
    ;;
  --logs|logs)
    run_dev &
    DEV_PID=$!
    trap 'kill "$DEV_PID" 2>/dev/null || true' EXIT INT TERM
    /usr/bin/log stream --info --style compact --predicate "process == \"$APP_PROCESS\""
    ;;
  --telemetry|telemetry)
    run_dev &
    DEV_PID=$!
    trap 'kill "$DEV_PID" 2>/dev/null || true' EXIT INT TERM
    /usr/bin/log stream --info --style compact --predicate 'subsystem BEGINSWITH "com.qx"'
    ;;
  --verify|verify)
    run_dev &
    DEV_PID=$!
    trap 'kill "$DEV_PID" 2>/dev/null || true' EXIT INT TERM
    for _ in {1..60}; do
      if pgrep -x "$APP_PROCESS" >/dev/null; then
        echo "$APP_NAME debug process is running"
        wait "$DEV_PID"
        exit 0
      fi
      sleep 1
    done
    echo "$APP_NAME debug process did not start within 60 seconds" >&2
    exit 1
    ;;
  --release|release)
    npm run tauri build
    if [[ ! -d "$APP_BUNDLE" ]]; then
      echo "App bundle not found: $APP_BUNDLE" >&2
      exit 1
    fi
    /usr/bin/open -n "$APP_BUNDLE"
    ;;
  *)
    echo "usage: $0 [--dev|--debug|--logs|--telemetry|--verify|--release]" >&2
    exit 2
    ;;
esac
