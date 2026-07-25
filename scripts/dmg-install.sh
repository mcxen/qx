#!/usr/bin/env bash

# Qx DMG installer. This script is intentionally small and can be run from a
# mounted read-only DMG; the app is copied to a writable Applications folder.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_SOURCE="${SCRIPT_DIR}/Qx.app"

if [[ ! -d "${APP_SOURCE}" ]]; then
  echo "找不到 Qx.app。请从 Qx 安装盘中运行 install.sh。" >&2
  exit 1
fi

echo "Qx 安装向导"
echo ""
echo "正在移除 macOS 下载隔离标记（com.apple.quarantine）……"
if command -v xattr >/dev/null 2>&1; then
  xattr -dr com.apple.quarantine "${APP_SOURCE}" 2>/dev/null || true
fi

if [[ -d /Applications && -w /Applications ]]; then
  TARGET_DIR="/Applications"
else
  TARGET_DIR="${HOME}/Applications"
  mkdir -p "${TARGET_DIR}"
  echo "当前用户无法写入 /Applications，将安装到 ${TARGET_DIR}。"
fi

TARGET_APP="${TARGET_DIR}/Qx.app"
echo "正在安装到 ${TARGET_APP}……"
ditto "${APP_SOURCE}" "${TARGET_APP}"

if command -v xattr >/dev/null 2>&1; then
  xattr -dr com.apple.quarantine "${TARGET_APP}" 2>/dev/null || true
fi

echo "安装完成。正在启动 Qx……"
open "${TARGET_APP}"
echo ""
echo "如果 macOS 仍提示无法打开，请在终端运行："
echo "xattr -dr com.apple.quarantine \"${TARGET_APP}\""
