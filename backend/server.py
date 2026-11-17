#!/usr/bin/env python3
"""家庭记账 - 本地 SQLite 服务
数据默认存在项目 data/ledger.db 中，换浏览器/清缓存都不丢。
只用 Python 标准库，无任何第三方依赖。
启动: python3 backend/server.py   然后访问 http://127.0.0.1:8899
"""
import argparse
import hashlib
import json
import secrets
import sqlite3
import sys
from contextlib import contextmanager
from datetime import date
from decimal import Decimal, InvalidOperation
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
DATA_DIR = ROOT / "data"
DEFAULT_DB = DATA_DIR / "ledger.db"
DB = DEFAULT_DB
PORT = 8899
MAX_BODY = 32 * 1024 * 1024
MAX_RECORDS = 50000
MAX_AMOUNT = 99999999.99
WRITE_TOKEN = secrets.token_urlsafe(32)


@contextmanager
def db():
    conn = sqlite3.connect(DB, timeout=10)
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def validate_data(body):
    if not isinstance(body, dict):
        raise ValueError("数据必须是 JSON 对象")
    recs, mems = body.get("records"), body.get("members")
    if not isinstance(recs, list) or len(recs) > MAX_RECORDS:
        raise ValueError("记录必须是数组，且不能超过 50000 条")
    if not isinstance(mems, list) or not 1 <= len(mems) <= 50:
        raise ValueError("成员数量必须在 1 到 50 之间")

    def text(value, label, limit, optional=False):
        if not isinstance(value, str) or len(value) > limit or (not optional and not value.strip()):
            raise ValueError(f"{label}必须是有效文本，最多 {limit} 个字符")
        return value

    members = [text(m, "成员名字", 32) for m in mems]
    if len(set(members)) != len(members):
        raise ValueError("成员名字不能重复")
    result, ids = [], set()
    for i, r in enumerate(recs, 1):
        if not isinstance(r, dict):
            raise ValueError(f"第 {i} 条记录格式不正确")
        rid = text(r.get("id"), "记录 ID", 128)
        if rid in ids:
            raise ValueError(f"第 {i} 条记录 ID 重复")
        ids.add(rid)
        kind = r.get("type")
        if kind not in ("income", "expense", "invest", "transfer"):
            raise ValueError(f"第 {i} 条记录类型不正确")
        day = text(r.get("date"), "日期", 10)
        try:
            if len(day) != 10 or date.fromisoformat(day).isoformat() != day or day < "1000-01-01":
                raise ValueError()
        except ValueError:
            raise ValueError(f"第 {i} 条记录日期不正确") from None
        amount = r.get("amount")
        if type(amount) not in (int, float):
            raise ValueError(f"第 {i} 条金额必须是数字")
        try:
            value = Decimal(str(amount))
            if not value.is_finite() or not 0 < value <= Decimal(str(MAX_AMOUNT)) or value * 100 != (value * 100).to_integral_value():
                raise ValueError()
        except (InvalidOperation, ValueError):
            raise ValueError(f"第 {i} 条金额须大于 0、不超过 {MAX_AMOUNT} 且最多两位小数") from None
        stamp = r.get("createdAt", 0)
        if type(stamp) is not int or not 0 <= stamp <= 9007199254740991:
            raise ValueError(f"第 {i} 条记录创建时间不正确")
        item = {"id": rid, "type": kind, "date": day, "amount": float(value),
                "createdAt": stamp, "note": text(r.get("note", ""), "备注", 500, True)}
        if kind in ("income", "expense"):
            item.update(category=text(r.get("category"), "分类", 64),
                        member=text(r.get("member", ""), "成员", 32, True))
        elif kind == "invest":
            if r.get("action") not in ("buy", "redeem", "profit"):
                raise ValueError(f"第 {i} 条理财操作不正确")
            item.update(action=r["action"], platform=text(r.get("platform"), "平台", 64))
        else:
            item["from"] = text(r.get("from"), "转出人", 32)
            item["to"] = text(r.get("to"), "转入人", 32)
            if item["from"] == item["to"]:
                raise ValueError("转出人和转入人不能相同")
        result.append(item)
    return result, members


def init_db():
    with db() as c:
        c.execute("PRAGMA journal_mode=WAL")
        c.execute(
            "CREATE TABLE IF NOT EXISTS records ("
            " seq INTEGER PRIMARY KEY AUTOINCREMENT,"
            " id TEXT UNIQUE,"
            " data TEXT NOT NULL)"
        )
        c.execute(
            "CREATE TABLE IF NOT EXISTS members ("
            " idx INTEGER PRIMARY KEY,"
            " name TEXT NOT NULL)"
        )
        c.execute("CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        c.execute("INSERT OR IGNORE INTO metadata VALUES ('revision', ?)", (secrets.token_hex(16),))
        if not c.execute("SELECT 1 FROM members LIMIT 1").fetchone():
            c.executemany("INSERT INTO members (idx, name) VALUES (?, ?)", enumerate(["明奇", "家人"]))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(FRONTEND), **kwargs)

    def log_message(self, fmt, *args):  # 静默访问日志
        pass

    def setup(self):
        super().setup()
        self.connection.settimeout(15)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        super().end_headers()

    def _trusted(self):
        port = self.server.server_port
        host = self.headers.get("Host", "")
        origin = self.headers.get("Origin")
        valid = host in (f"127.0.0.1:{port}", f"localhost:{port}")
        valid = valid and (origin is None or origin == f"http://{host}")
        if not valid:
            self._json(403, {"ok": False, "error": "仅允许本机同源访问"})
        return valid

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_head(self):
        if not self._trusted():
            return None
        path = urlsplit(self.path).path
        name = {
            "/": "index.html",
            "/index.html": "index.html",
            "/styles/app.css": "styles/app.css",
            "/js/app.js": "js/app.js",
            "/js/view-context.js": "js/view-context.js",
            "/pages/detail.js": "pages/detail.js",
            "/pages/stats.js": "pages/stats.js",
            "/pages/invest.js": "pages/invest.js",
            "/pages/settings.js": "pages/settings.js",
            "/components/tab-bar.js": "components/tab-bar.js",
            "/components/record-drawer.js": "components/record-drawer.js",
            "/components/confirm-dialog.js": "components/confirm-dialog.js",
            "/vendor/vue.global.prod.js": "vendor/vue.global.prod.js",
        }.get(path)
        if name is None:
            self.send_error(404)
            return None
        target = FRONTEND / name
        try:
            stat = target.stat()
        except OSError:
            self.send_error(404)
            return None
        etag = '"' + hashlib.sha256(f"{stat.st_mtime_ns}:{stat.st_size}".encode()).hexdigest() + '"'
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            return None
        self.send_response(200)
        mime = {".html": "text/html", ".css": "text/css", ".js": "text/javascript"}[target.suffix]
        self.send_header("Content-Type", mime + "; charset=utf-8")
        self.send_header("Content-Length", str(stat.st_size))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("ETag", etag)
        self.end_headers()
        return target.open("rb")

    def do_GET(self):
        if not self._trusted():
            return
        path = urlsplit(self.path).path
        if path == "/api/health":
            self._json(200, {"app": "family-ledger", "protocol": 2})
        elif path == "/api/data":
            try:
                with db() as c:
                    c.execute("BEGIN")
                    rows = c.execute("SELECT data FROM records ORDER BY seq").fetchall()
                    mem = [r[0] for r in c.execute("SELECT name FROM members ORDER BY idx")]
                    revision = c.execute("SELECT value FROM metadata WHERE key='revision'").fetchone()[0]
                records = [json.loads(r[0]) for r in rows]
                self._json(200, {"records": records, "members": mem, "revision": revision, "token": WRITE_TOKEN})
            except (sqlite3.Error, ValueError):
                self._json(500, {"ok": False, "error": "账本读取失败，请检查数据库及服务日志"})
        else:
            super().do_GET()

    def do_POST(self):
        if not self._trusted():
            return
        if self.path != "/api/replace":
            self._json(404, {"ok": False, "error": "接口不存在"})
            return
        if not secrets.compare_digest(self.headers.get("X-Ledger-Token", "").encode("utf-8"), WRITE_TOKEN.encode("ascii")):
            self._json(403, {"ok": False, "error": "服务已重启或请求无效，请重新加载账本"})
            return
        if self.headers.get_content_type() != "application/json":
            self._json(415, {"ok": False, "error": "只接受 application/json"})
            return
        try:
            n = int(self.headers.get("Content-Length", 0))
            if self.headers.get("Transfer-Encoding") or not 0 < n <= MAX_BODY:
                self._json(413, {"ok": False, "error": "请求大小必须在 1 字节到 32 MiB 之间"})
                return
            body = json.loads(self.rfile.read(n))
            recs, mems = validate_data(body)
            revision = body.get("revision")
            if not isinstance(revision, str):
                raise ValueError("缺少账本版本，请重新加载页面")
            with db() as c:  # with 块结束自动 commit
                c.execute("BEGIN IMMEDIATE")
                current = c.execute("SELECT value FROM metadata WHERE key='revision'").fetchone()[0]
                if revision != current:
                    self._json(409, {"ok": False, "error": "账本已被其他页面修改，请重新加载后再操作"})
                    return
                c.execute("CREATE TEMP TABLE incoming (id TEXT PRIMARY KEY, data TEXT NOT NULL)")
                c.executemany("INSERT INTO incoming VALUES (?, ?)",
                              ((r["id"], json.dumps(r, ensure_ascii=False, sort_keys=True)) for r in recs))
                c.execute("DELETE FROM records WHERE NOT EXISTS (SELECT 1 FROM incoming WHERE incoming.id=records.id)")
                c.execute("INSERT INTO records (id, data) SELECT id, data FROM incoming WHERE 1 "
                          "ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE records.data<>excluded.data")
                current_members = [r[0] for r in c.execute("SELECT name FROM members ORDER BY idx")]
                if current_members != mems:
                    c.execute("DELETE FROM members")
                    c.executemany("INSERT INTO members (idx, name) VALUES (?, ?)", enumerate(mems))
                new_revision = secrets.token_hex(16)
                c.execute("UPDATE metadata SET value=? WHERE key='revision'", (new_revision,))
            self._json(200, {"ok": True, "records": len(recs), "revision": new_revision})
        except (ValueError, UnicodeError, RecursionError) as e:
            self._json(400, {"ok": False, "error": str(e)})
        except sqlite3.Error:
            self._json(503, {"ok": False, "error": "数据库暂时不可写，请检查磁盘空间或稍后重试"})
        except TimeoutError:
            self._json(408, {"ok": False, "error": "请求读取超时"})


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="家庭记账本地服务，仅监听本机")
    if sys.version_info < (3, 9) or sqlite3.sqlite_version_info < (3, 24):
        parser.error("需要 Python 3.9+ 和 SQLite 3.24+，请升级 Python")
    parser.add_argument("--port", type=int, default=PORT)
    parser.add_argument("--db", type=Path, default=DB, help="数据库文件路径")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("端口必须在 1 到 65535 之间")
    PORT, DB = args.port, args.db.expanduser().resolve()
    try:
        srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
        if DB == DEFAULT_DB:
            if (ROOT / "ledger.db").exists():
                raise OSError("检测到项目根目录的旧账本，请停服后按 README 迁移到 data/ledger.db，避免误用空账本")
            DATA_DIR.mkdir(parents=True, exist_ok=True)
        init_db()
    except (OSError, sqlite3.Error) as e:
        print(f"启动失败：{e}。请检查端口、数据库路径及文件权限。", file=sys.stderr)
        sys.exit(1)
    print(f"家庭记账服务已启动 → http://127.0.0.1:{PORT}   数据库: {DB}", flush=True)
    print("在本终端按 Control+C 停止服务。", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n服务已停止。")
    finally:
        srv.server_close()
        with db() as c:
            c.execute("PRAGMA wal_checkpoint(TRUNCATE)")
