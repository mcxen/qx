#!/usr/bin/env bash

# Build a Finder-friendly drag-to-Applications DMG with a Read Me and the
# quarantine-aware install.sh helper.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
APP_PATH=""
OUTPUT_PATH=""
VOLUME_NAME="Qx"
RELEASE_TAG=""

usage() {
  echo "Usage: $0 --app APP_PATH --output OUTPUT_PATH [--volume-name NAME] [--release-tag TAG]" >&2
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app) APP_PATH="${2:-}"; shift 2 ;;
    --output) OUTPUT_PATH="${2:-}"; shift 2 ;;
    --volume-name) VOLUME_NAME="${2:-}"; shift 2 ;;
    --release-tag) RELEASE_TAG="${2:-}"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "Unknown argument: $1" >&2; usage ;;
  esac
done

[[ -n "${APP_PATH}" && -n "${OUTPUT_PATH}" ]] || usage
[[ -d "${APP_PATH}" ]] || { echo "App bundle not found: ${APP_PATH}" >&2; exit 1; }
command -v hdiutil >/dev/null 2>&1 || { echo "hdiutil is required on macOS" >&2; exit 1; }

SPONSOR_ASSET="${REPO_ROOT}/assets/sponsor-wechat.png"
[[ -f "${SPONSOR_ASSET}" ]] || { echo "Missing sponsor asset: ${SPONSOR_ASSET}" >&2; exit 1; }

STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/qx-dmg.XXXXXX")"
cleanup() { rm -rf "${STAGING_DIR}"; }
trap cleanup EXIT

cp -R "${APP_PATH}" "${STAGING_DIR}/Qx.app"
ln -s /Applications "${STAGING_DIR}/Applications"
install -m 0755 "${SCRIPT_DIR}/dmg-install.sh" "${STAGING_DIR}/install.sh"
sed "s|__RELEASE_TAG__|${RELEASE_TAG}|g" "${SCRIPT_DIR}/dmg-readme.html" > "${STAGING_DIR}/Read Me.html"
cp "${SPONSOR_ASSET}" "${STAGING_DIR}/sponsor-wechat.png"

mkdir -p "$(dirname -- "${OUTPUT_PATH}")"
hdiutil create \
  -volname "${VOLUME_NAME}" \
  -srcfolder "${STAGING_DIR}" \
  -fs HFS+ \
  -format UDZO \
  -ov \
  "${OUTPUT_PATH}"

echo "Created ${OUTPUT_PATH}"
