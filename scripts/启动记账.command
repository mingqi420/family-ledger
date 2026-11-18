#!/bin/bash
# 家庭记账 一键启动：双击此文件即可，会自动开浏览器
cd "$(dirname "$0")/.." || exit 1
if ! command -v python3 >/dev/null 2>&1; then
  printf '未找到 Python 3，请先安装 Python 3.9 或更新版本。\n'
  exit 1
fi

# 检查服务身份和就绪状态，并让服务生命周期跟随当前终端
python3 -u - <<'PY'
import errno
import json
import signal
import sqlite3
import subprocess
import sys
import time
from urllib.error import URLError
from urllib.request import ProxyHandler, build_opener

if sys.version_info < (3, 9) or sqlite3.sqlite_version_info < (3, 24):
    sys.exit('需要 Python 3.9+ 和 SQLite 3.24+，请升级 Python。')

url = 'http://127.0.0.1:8899'
opener = build_opener(ProxyHandler({}))

def healthy():
    with opener.open(url + '/api/health', timeout=1) as response:
        data = json.load(response)
        return data.get('app') == 'family-ledger' and data.get('protocol') == 3

try:
    if not healthy():
        sys.exit('8899 端口被其他服务占用，请检查后重试。')
except URLError as error:
    if getattr(error.reason, 'errno', None) != errno.ECONNREFUSED:
        sys.exit('8899 端口已有旧版服务或不可访问，请在原终端停止服务后重试。')
except (ValueError, TimeoutError, OSError):
    sys.exit('8899 端口不是可用的记账服务，请检查端口占用。')
else:
    subprocess.run(['open', url], check=False)
    print('账本服务已在其他终端运行，已打开浏览器；停止服务请使用原终端。')
    sys.exit(0)

def stop_signal(signum, frame):
    raise KeyboardInterrupt

signal.signal(signal.SIGTERM, stop_signal)
signal.signal(signal.SIGHUP, stop_signal)
child = subprocess.Popen([sys.executable, '-u', 'backend/server.py'], start_new_session=True)
try:
    for _ in range(50):
        if child.poll() is not None:
            sys.exit('服务启动失败，请查看上方错误信息。')
        try:
            if healthy():
                subprocess.run(['open', url], check=False)
                break
        except (URLError, ValueError, TimeoutError, OSError):
            pass
        time.sleep(0.2)
    else:
        sys.exit('等待服务就绪超时，请查看上方错误信息。')
    print('请保留此终端窗口；按 Control+C 可停止服务。')
    code = child.wait()
    if code:
        sys.exit(code)
except KeyboardInterrupt:
    print('\n正在停止记账服务…')
finally:
    if child.poll() is None:
        child.send_signal(signal.SIGINT)
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            child.terminate()
            child.wait()
PY
