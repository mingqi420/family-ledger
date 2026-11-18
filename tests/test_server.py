"""接口回归测试：仅使用临时数据库，不读取真实账本。"""
import errno
import http.client
import io
import json
import os
import re
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest import mock
from urllib.error import URLError

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))
from backend import server


def record(rid="test-1", **overrides):
    value = {"id": rid, "type": "expense", "amount": 12.34, "date": "2026-01-02",
             "category": "餐饮", "memberId": "m-test", "member": "测试成员", "note": "", "createdAt": 1}
    value.update(overrides)
    return value


class LedgerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.original_db = server.DB
        server.DB = Path(self.temp.name) / "test.db"
        server.init_db()
        self.http = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.http.server_port

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join()
        server.DB = self.original_db
        self.temp.cleanup()

    def request(self, method="GET", path="/api/data", body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=20)
        defaults = {"Content-Type": "application/json", "X-Ledger-Token": server.WRITE_TOKEN,
                    "Origin": f"http://127.0.0.1:{self.port}"}
        defaults.update(headers or {})
        encoded = json.dumps(body) if body is not None else None
        conn.request(method, path, body=encoded, headers=defaults)
        res = conn.getresponse()
        raw = res.read()
        result = json.loads(raw) if raw and "application/json" in res.getheader("Content-Type", "") else raw
        status, response_headers = res.status, dict(res.getheaders())
        conn.close()
        return status, result, response_headers

    def data(self):
        status, data, _ = self.request()
        self.assertEqual(status, 200)
        return data

    def save(self, recs=None, **overrides):
        payload = {"records": recs if recs is not None else [record()],
                   "members": [{"id": "m-test", "name": "测试成员"}],
                   "revision": self.data()["revision"]}
        payload.update(overrides)
        return self.request("POST", "/api/replace", payload)

    def test_initial_read_does_not_write(self):
        first = self.data()
        self.assertEqual(first["records"], [])
        self.assertTrue(first["members"])
        self.assertEqual(first["revision"], self.data()["revision"])
        status, health, _ = self.request(path="/api/health")
        self.assertEqual(status, 200)
        self.assertEqual(health, {"app": "family-ledger", "protocol": 3})

    def test_round_trip_all_types_and_clear(self):
        records = [record(), record("income", type="income"),
                   record("buy", type="invest", action="buy", platform="测试平台"),
                   record("transfer", type="transfer", **{"fromId": "ma", "toId": "mb", "from": "甲", "to": "乙"})]
        self.assertEqual(self.save(records)[0], 200)
        self.assertEqual(len(self.data()["records"]), 4)
        self.assertEqual(self.save([])[0], 200)
        revision = self.data()["revision"]
        self.assertEqual(self.data()["records"], [])
        self.assertEqual(self.data()["revision"], revision)

    def test_rejects_invalid_records_without_data_loss(self):
        self.assertEqual(self.save()[0], 200)
        before = self.data()
        invalid = [{"id": "bad"}, record(amount=True), record(amount="10"), record(amount=0),
                   record(amount=-1), record(amount=1.234), record(amount=float("inf")),
                   record(amount=float("nan")), record(amount=server.MAX_AMOUNT + 1),
                   record(date="2026-02-30"), record(date="2026-1-1"), record(date="0001-01-01"),
                   record(type="bad"), record(createdAt=-1), record(createdAt=1.5),
                   record(note={}), record(category=""), record(type="invest", action="bad"),
                   record(type="transfer", fromId="a", toId="a")]
        for item in invalid:
            with self.subTest(item=item):
                self.assertEqual(self.save([item])[0], 400)
                self.assertEqual(self.data(), before)
        self.assertEqual(self.save([record(), record()])[0], 400)
        self.assertEqual(self.data(), before)

    def test_invalid_envelopes_are_not_clear_commands(self):
        self.assertEqual(self.save()[0], 200)
        before = self.data()
        for body in ({}, [], {"records": []}, {"records": [], "members": []},
                     {"records": [], "members": ["甲"]},
                     {"records": [], "members": [{"id": "a", "name": "甲"}, {"id": "b", "name": "甲"}]},
                     {"records": [], "members": [{"id": "a", "name": "甲"}, {"id": "a", "name": "乙"}]}):
            self.assertEqual(self.request("POST", "/api/replace", body)[0], 400)
            self.assertEqual(self.data(), before)

    def test_optimistic_lock_prevents_lost_updates(self):
        old = self.data()["revision"]
        self.assertEqual(self.save([record("a")], revision=old)[0], 200)
        self.assertEqual(self.save([record("b")], revision=old)[0], 409)
        self.assertEqual([r["id"] for r in self.data()["records"]], ["a"])

    def test_concurrent_writers_only_one_succeeds(self):
        revision = self.data()["revision"]
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(self.save, [record(str(i))], revision=revision) for i in range(2)]
            self.assertEqual(sorted(f.result()[0] for f in futures), [200, 409])
        self.assertEqual(len(self.data()["records"]), 1)

    def test_origin_host_token_and_content_type(self):
        payload = {"records": [], "members": [{"id": "a", "name": "甲"}], "revision": self.data()["revision"]}
        cases = [({"Origin": "https://example.com"}, 403),
                 ({"Host": "attacker.example"}, 403), ({"X-Ledger-Token": ""}, 403),
                 ({"X-Ledger-Token": "é"}, 403),
                 ({"Content-Type": "text/plain"}, 415)]
        for headers, expected in cases:
            self.assertEqual(self.request("POST", "/api/replace", payload, headers)[0], expected)
        self.assertEqual(self.request(headers={"Host": "attacker.example"})[0], 403)

    def test_body_limit_and_bad_json(self):
        headers = {"Content-Length": str(server.MAX_BODY + 1)}
        self.assertEqual(self.request("POST", "/api/replace", {}, headers)[0], 413)
        self.assertEqual(self.request("POST", "/api/replace", {}, {"Content-Length": "invalid"})[0], 400)
        self.assertEqual(self.request("POST", "/api/replace", None)[0], 413)

    def test_static_whitelist_and_cache(self):
        for path in ("/ledger.db", "/ledger.db-wal", "/.git/config", "/server.py", "/../server.py", "/%2e%2e/server.py",
                     "/data/ledger.db", "/data/ledger.db-wal", "/backend/server.py", "/scripts/start.sh", "/tests/test_server.py",
                     "/styles/../../backend/server.py", "/styles/%2e%2e/%2e%2e/backend/server.py",
                     "/pages/", "/components/", "/pages/unknown.js", "/components/unknown.js",
                     "/pages/../../data/ledger.db", "/components/%2e%2e/%2e%2e/backend/server.py",
                     "/pages/detail.js/extra", "/pages/detail.js.map", "/tests/helpers/vue-renderer.cjs"):
            for method in ("GET", "HEAD"):
                self.assertEqual(self.request(method, path)[0], 404)
        for path in ("/", "/index.html", "/vendor/vue.global.prod.js", "/js/app.js", "/styles/app.css",
                     "/js/view-context.js", "/pages/detail.js", "/pages/stats.js", "/pages/invest.js", "/pages/settings.js",
                     "/components/tab-bar.js", "/components/record-drawer.js", "/components/confirm-dialog.js"):
            status, body, headers = self.request(path=path)
            self.assertEqual(status, 200)
            self.assertTrue(body)
            self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
            expected_type = "text/css" if path.endswith(".css") else "text/javascript" if path.endswith(".js") else "text/html"
            self.assertEqual(headers["Content-Type"], expected_type + "; charset=utf-8")
            self.assertEqual(self.request(path=path, headers={"If-None-Match": headers["ETag"]})[0], 304)
            head_status, head_body, head_headers = self.request("HEAD", path)
            self.assertEqual(head_status, 200)
            self.assertEqual(head_body, b"")
            self.assertEqual(head_headers["Content-Length"], str(len(body)))
            self.assertEqual(self.request("HEAD", path, headers={"If-None-Match": headers["ETag"]})[0], 304)

    def test_index_dependencies_are_served(self):
        status, page, _ = self.request(path="/")
        self.assertEqual(status, 200)
        assets = re.findall(r'(?:src|href)="(/[^\"]+)"', page.decode("utf-8"))
        self.assertEqual(len(assets), 11)
        for asset in assets:
            with self.subTest(asset=asset):
                status, body, _ = self.request(path=asset)
                self.assertEqual(status, 200)
                self.assertEqual(body, (server.FRONTEND / asset.lstrip("/")).read_bytes())

    def test_unlisted_frontend_files_stay_private(self):
        frontend = Path(self.temp.name) / "frontend"
        for folder in ("pages", "components"):
            (frontend / folder).mkdir(parents=True)
            (frontend / folder / "private.js").write_text("private-sentinel", encoding="utf-8")
        with mock.patch.object(server, "FRONTEND", frontend):
            for folder in ("pages", "components"):
                for method in ("GET", "HEAD"):
                    self.assertEqual(self.request(method, f"/{folder}/private.js")[0], 404)

    def test_only_changed_rows_are_updated(self):
        records = [record("keep"), record("change"), record("remove")]
        self.assertEqual(self.save(records)[0], 200)
        with server.db() as conn:
            seq = conn.execute("SELECT seq FROM records WHERE id='keep'").fetchone()[0]
            conn.execute("CREATE TABLE audit (id TEXT)")
            conn.execute("CREATE TRIGGER record_updates AFTER UPDATE ON records BEGIN INSERT INTO audit VALUES (new.id); END")
        updated = [records[0], record("change", amount=20), record("new")]
        self.assertEqual(self.save(updated)[0], 200)
        with server.db() as conn:
            self.assertEqual(conn.execute("SELECT seq FROM records WHERE id='keep'").fetchone()[0], seq)
            self.assertEqual(conn.execute("SELECT id FROM audit").fetchall(), [("change",)])
            self.assertEqual(conn.execute("SELECT count(*) FROM records").fetchone()[0], 3)

    def test_database_failure_rolls_back(self):
        self.assertEqual(self.save()[0], 200)
        before = self.data()
        with server.db() as conn:
            conn.execute("CREATE TRIGGER reject_insert BEFORE INSERT ON records WHEN new.id='reject' BEGIN SELECT RAISE(ABORT, 'test'); END")
        self.assertEqual(self.save([record("reject")])[0], 503)
        self.assertEqual(self.data(), before)

    def test_large_snapshot(self):
        records = [record(str(i), amount=0.01) for i in range(10000)]
        self.assertEqual(self.save(records)[0], 200)
        self.assertEqual(len(self.data()["records"]), 10000)
        records[5000]["amount"] = 0.02
        self.assertEqual(self.save(records)[0], 200)
        self.assertEqual(self.data()["records"][5000]["amount"], 0.02)

    def test_legacy_schema_migration_keeps_records(self):
        legacy = Path(self.temp.name) / "legacy.db"
        conn = sqlite3.connect(legacy)
        conn.execute("CREATE TABLE records (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE, data TEXT NOT NULL)")
        conn.execute("CREATE TABLE members (idx INTEGER PRIMARY KEY, name TEXT NOT NULL)")
        conn.execute("INSERT INTO records (id, data) VALUES (?, ?)", ("old", json.dumps(record("old"))))
        conn.commit()
        conn.close()
        server.DB = legacy
        server.init_db()
        self.assertEqual(self.data()["records"][0]["id"], "old")
        self.assertTrue(self.data()["members"])
        revision = self.data()["revision"]
        server.init_db()
        self.assertEqual(self.data()["revision"], revision)

    def test_migration_backfills_member_ids_from_names(self):
        legacy = Path(self.temp.name) / "mig.db"
        conn = sqlite3.connect(legacy)
        conn.execute("CREATE TABLE records (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE, data TEXT NOT NULL)")
        conn.execute("CREATE TABLE members (idx INTEGER PRIMARY KEY, name TEXT NOT NULL)")
        conn.executemany("INSERT INTO members (idx, name) VALUES (?, ?)", [(0, "明奇"), (1, "家人")])
        conn.execute("INSERT INTO records (id, data) VALUES (?, ?)", ("r1", json.dumps(
            {"id": "r1", "type": "expense", "amount": 5.0, "date": "2026-01-02",
             "category": "餐饮", "member": "家人", "note": "", "createdAt": 1})))
        conn.execute("INSERT INTO records (id, data) VALUES (?, ?)", ("r2", json.dumps(
            {"id": "r2", "type": "transfer", "amount": 5.0, "date": "2026-01-02",
             "note": "", "createdAt": 1, "from": "明奇", "to": "家人"})))
        conn.commit()
        conn.close()
        server.DB = legacy
        server.init_db()
        data = self.data()
        id_by_name = {m["name"]: m["id"] for m in data["members"]}
        recs = {r["id"]: r for r in data["records"]}
        self.assertTrue(id_by_name["明奇"] and id_by_name["家人"])
        self.assertEqual(recs["r1"]["memberId"], id_by_name["家人"])
        self.assertEqual(recs["r2"]["fromId"], id_by_name["明奇"])
        self.assertEqual(recs["r2"]["toId"], id_by_name["家人"])


class DeploymentPathTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "项目 带空格"
        self.cwd = Path(self.temp.name) / "无关工作目录"
        self.cwd.mkdir()
        for name in ("backend", "frontend", "scripts"):
            (self.root / name).mkdir(parents=True)
        shutil.copy2(PROJECT_ROOT / "backend/server.py", self.root / "backend/server.py")
        shutil.copy2(PROJECT_ROOT / "scripts/start.sh", self.root / "scripts/start.sh")
        shutil.copytree(PROJECT_ROOT / "frontend", self.root / "frontend", dirs_exist_ok=True)
        self.env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONDONTWRITEBYTECODE="1")

    def tearDown(self):
        self.temp.cleanup()

    def free_port(self):
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            return sock.getsockname()[1]

    def check_start(self, command, expected_db):
        port = self.free_port()
        child = subprocess.Popen([*command, "--port", str(port)], cwd=self.cwd, env=self.env,
                                 stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                 text=True, encoding="utf-8")
        try:
            for _ in range(100):
                if child.poll() is not None:
                    self.fail("服务提前退出：" + child.stdout.read())
                conn = http.client.HTTPConnection("127.0.0.1", port, timeout=0.5)
                try:
                    conn.request("GET", "/")
                    response = conn.getresponse()
                    self.assertEqual(response.status, 200)
                    self.assertEqual(response.read(), (self.root / "frontend/index.html").read_bytes())
                    break
                except OSError:
                    time.sleep(0.05)
                finally:
                    conn.close()
            else:
                self.fail("服务未在限定时间内就绪")
            for asset in ("js/view-context.js", "pages/detail.js", "components/record-drawer.js"):
                conn = http.client.HTTPConnection("127.0.0.1", port, timeout=2)
                try:
                    conn.request("GET", "/" + asset)
                    response = conn.getresponse()
                    self.assertEqual(response.status, 200)
                    self.assertEqual(response.read(), (self.root / "frontend" / asset).read_bytes())
                finally:
                    conn.close()
            self.assertTrue(expected_db.is_file())
            self.assertFalse((self.cwd / "ledger.db").exists())
            self.assertFalse((self.root / "backend/ledger.db").exists())
        finally:
            if child.poll() is None:
                if os.name == "nt":
                    child.terminate()
                else:
                    child.send_signal(signal.SIGINT)
            try:
                child.communicate(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
                child.communicate()

    def test_default_paths_from_unrelated_directory(self):
        self.check_start([sys.executable, "-u", str(self.root / "backend/server.py")],
                         self.root / "data/ledger.db")

    @unittest.skipIf(os.name == "nt", "Windows 使用批处理入口")
    def test_shell_entry_forwards_custom_database(self):
        target = self.cwd / "独立 账本.db"
        self.check_start(["bash", str(self.root / "scripts/start.sh"), "--db", str(target)], target)
        self.assertFalse((self.root / "data/ledger.db").exists())

    def test_legacy_root_database_prevents_empty_default(self):
        legacy = self.root / "ledger.db"
        legacy.write_bytes(b"legacy-sentinel")
        result = subprocess.run([sys.executable, str(self.root / "backend/server.py"),
                                 "--port", str(self.free_port())], cwd=self.cwd, env=self.env,
                                capture_output=True, text=True, encoding="utf-8", timeout=10)
        self.assertEqual(result.returncode, 1)
        self.assertIn("根目录的旧账本", result.stderr)
        self.assertFalse((self.root / "data/ledger.db").exists())
        self.assertEqual(legacy.read_bytes(), b"legacy-sentinel")


@unittest.skipIf(os.name == "nt", "macOS 启动脚本的信号语义在类 Unix 系统验证")
class LauncherTests(unittest.TestCase):
    def run_script(self, replies, child=None):
        script = (PROJECT_ROOT / "scripts" / "启动记账.command").read_text(encoding="utf-8")
        source = script.split("<<'PY'\n", 1)[1].rsplit("\nPY", 1)[0]
        with mock.patch("urllib.request.build_opener") as opener, \
                mock.patch("subprocess.Popen", return_value=child) as spawn, \
                mock.patch("subprocess.run") as browser, \
                mock.patch("signal.signal"), mock.patch("time.sleep"), mock.patch("builtins.print"):
            opener.return_value.open.side_effect = replies
            try:
                exec(compile(source, "启动记账.command", "exec"), {})
                code = 0
            except SystemExit as error:
                code = error.code
            return code, spawn, browser

    def health(self):
        return io.StringIO('{"app":"family-ledger","protocol":3}')

    def test_existing_service_is_reused(self):
        code, spawn, browser = self.run_script([self.health()])
        self.assertEqual(code, 0)
        spawn.assert_not_called()
        browser.assert_called_once()

    def test_unknown_service_is_not_reused(self):
        code, spawn, browser = self.run_script([io.StringIO('{"app":"other"}')])
        self.assertNotEqual(code, 0)
        spawn.assert_not_called()
        browser.assert_not_called()

    def test_launcher_stops_its_own_child(self):
        child = mock.Mock()
        child.poll.return_value = None
        child.wait.side_effect = [KeyboardInterrupt(), 0]
        refused = URLError(OSError(errno.ECONNREFUSED, "测试端口未占用"))
        code, spawn, browser = self.run_script([refused, self.health()], child)
        self.assertEqual(code, 0)
        self.assertTrue(spawn.call_args.kwargs["start_new_session"])
        self.assertEqual(spawn.call_args.args[0][-1], "backend/server.py")
        browser.assert_called_once()
        child.send_signal.assert_called_once_with(signal.SIGINT)


if __name__ == "__main__":
    unittest.main()
