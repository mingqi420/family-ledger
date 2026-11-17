#!/usr/bin/env bash
# Linux 前台启动入口，也可在 macOS 终端使用；支持转发服务参数。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if ! command -v python3 >/dev/null 2>&1; then
  printf '未找到 Python 3，请先安装 Python 3.9 或更新版本。\n' >&2
  exit 1
fi
exec python3 -u "$ROOT/backend/server.py" "$@"
