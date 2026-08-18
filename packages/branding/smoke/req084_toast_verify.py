#!/usr/bin/env python3
"""REQ-084① 数据库隔离 toast 真机验证 [feat: voice-preclear-batch] 2026-08-18

1-spec §3-S1 的 R8 用例 T5 要求「toast 可见(截图)」—— verify-db-schema-guard.sh 验的是
文件层处置(隔离挪档),本脚本补上用户可见性这一环。

做法:造 T5 场景(deskfox ns 内放超前 db + marker 已写)→ 起 local 包并开 CDP →
等 renderer 就绪 → 查 toast DOM 文案 → 截图存证。

隔离:HOME 指向临时目录(不能用 XDG,理由见 verify-db-schema-guard.sh);
     CDP 端口用 9333 避开 user 可能在用的 9222;只 kill "DeskFox 本地版"。

用法: python3 packages/branding/smoke/req084_toast_verify.py
"""
import base64
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.request

import websocket  # pip install websocket-client

PORT = 9333
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))
APP = os.path.join(REPO, "packages/desktop/dist-deskfox/mac-arm64/DeskFox 本地版.app")
BIN = os.path.join(APP, "Contents/MacOS/DeskFox 本地版")
BASELINE = os.path.join(REPO, "packages/desktop/src/main/deskfox/migration-baseline.generated.ts")
DB_NAME = "opencode-local.db"
PROBE = "99991231235959_pollution_probe"
SHOTS = os.path.join(os.path.dirname(__file__), "_shots")


def baseline_ids(n=5):
    import re

    ids = re.findall(r'"(\d{14}_[^"]+)"', open(BASELINE, encoding="utf-8").read())
    return ids[:n]


def make_ahead_db(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sql = ["CREATE TABLE migration (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL);"]
    for i in baseline_ids():
        sql.append(f"INSERT INTO migration VALUES ('{i}', 1);")
    sql.append(f"INSERT INTO migration VALUES ('{PROBE}', 1);")
    subprocess.run(["sqlite3", path], input="\n".join(sql), text=True, check=True)


def kill_local():
    subprocess.run(["pkill", "-f", "DeskFox 本地版.app/Contents/"], capture_output=True)
    time.sleep(1)


def cdp_page(timeout=60):
    """等 renderer page target 出现。"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json", timeout=3))
            for t in targets:
                if t.get("type") == "page" and t.get("webSocketDebuggerUrl"):
                    return t["webSocketDebuggerUrl"]
        except Exception:
            pass
        time.sleep(1)
    return None


class CDP:
    def __init__(self, url):
        self.ws = websocket.create_connection(url, timeout=20, suppress_origin=True, max_size=80_000_000)
        self.id = 0

    def call(self, method, params=None):
        self.id += 1
        mid = self.id
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                return msg.get("result", {})

    def ev(self, expr):
        r = self.call(
            "Runtime.evaluate",
            {"expression": expr, "returnByValue": True, "awaitPromise": True},
        )
        if "exceptionDetails" in r:
            return {"__error__": str(r["exceptionDetails"])[:300]}
        return r.get("result", {}).get("value")

    def shot(self, path):
        r = self.call("Page.captureScreenshot", {"format": "png"})
        data = r.get("data")
        if not data:
            return False
        os.makedirs(os.path.dirname(path), exist_ok=True)
        open(path, "wb").write(base64.b64decode(data))
        return True


def main():
    if not os.access(BIN, os.X_OK):
        print(f"❌ 找不到 local 包:{BIN}")
        return 1

    kill_local()
    work = tempfile.mkdtemp(prefix="deskfox-req084-toast.")
    home = os.path.join(work, "home")
    ns = os.path.join(home, ".local/share/deskfox/opencode")
    os.makedirs(ns, exist_ok=True)
    os.makedirs(os.path.join(home, ".config/deskfox/opencode"), exist_ok=True)
    make_ahead_db(os.path.join(ns, DB_NAME))
    # marker 已写 = 迁移逻辑不会再跑,只能靠启动期自愈(正是 T5 的「历史遗留」)
    open(os.path.join(ns, ".deskfox-namespace-migrated"), "w").write('{"from":"qa"}')

    env = dict(os.environ)
    env["HOME"] = home
    env.pop("XDG_DATA_HOME", None)
    env.pop("XDG_CONFIG_HOME", None)

    print(f"临时 HOME:{home}")
    print("起 local 包(CDP :%d)…" % PORT)
    # --use-mock-keychain 必带:HOME 被改后钥匙串路径也跟着变,app 找不到条目会弹
    # 「找不到钥匙串」系统对话框打断跑批(2026-08-18 实测撞到);mock 让它用内存态,不碰真钥匙串。
    proc = subprocess.Popen(
        [BIN, f"--remote-debugging-port={PORT}", "--use-mock-keychain"],
        env=env,
        stdout=open(os.path.join(work, "app.log"), "w"),
        stderr=subprocess.STDOUT,
    )

    rc = 1
    try:
        url = cdp_page()
        if not url:
            print("❌ CDP page target 没出现(app 没起来?)")
            print(open(os.path.join(work, "app.log")).read()[-2000:])
            return 1
        cdp = CDP(url)
        cdp.call("Page.enable")
        cdp.call("Runtime.enable")

        # 等 renderer 挂载 + DbQuarantineMonitor onMount 取数弹 toast
        found = None
        deadline = time.time() + 60
        while time.time() < deadline:
            txt = cdp.ev("document.body ? document.body.innerText : ''")
            if isinstance(txt, str) and ("已另存备份" in txt or "不兼容" in txt):
                found = txt
                break
            time.sleep(2)

        # 隔离是否真发生(文件层复核,和 toast 互为印证)
        quarantined = [f for f in os.listdir(ns) if ".incompatible-" in f]
        print(f"\n文件层:隔离产物 {quarantined if quarantined else '(无)'}")

        shot = os.path.join(SHOTS, "req084-quarantine-toast.png")
        got_shot = cdp.shot(shot)

        if found:
            line = [l for l in found.splitlines() if "备份" in l or "不兼容" in l]
            print("✅ toast 可见:", " / ".join(line[:2])[:160])
            rc = 0
        else:
            print("❌ 未在页面上看到隔离提示文案")
            body = cdp.ev("document.body ? document.body.innerText.slice(0,600) : '(no body)'")
            print("   页面文本片段:", str(body)[:400])
        if got_shot:
            print(f"📸 截图:{shot}")
        if not quarantined:
            print("⚠ 文件层未见隔离产物 —— toast 与处置不一致,需排查")
            rc = 1
    finally:
        try:
            proc.send_signal(signal.SIGTERM)
        except Exception:
            pass
        kill_local()
        if rc == 0:
            shutil.rmtree(work, ignore_errors=True)
        else:
            print(f"(临时目录保留排查:{work})")
    return rc


if __name__ == "__main__":
    sys.exit(main())
