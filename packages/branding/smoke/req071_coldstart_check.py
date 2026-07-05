#!/usr/bin/env python3
"""REQ-071 冷启动读回回归检查:kill+relaunch 后打开 A,断言草稿从盘读回。
验证再水合修改(把 ready 纳入 reconcile 依赖)不破坏冷启动路径。"""
import sys, time
from req071_draft_test import CDP, open_project, composer_text, wait_for, A_B64, MARKER

cdp = CDP()
cdp.send("Runtime.enable")
# 等 renderer 就绪(project-switch 按钮出现)
wait_for(cdp, 'document.querySelectorAll(\'[data-action="project-switch"]\').length >= 1', True,
         timeout=30, desc="renderer ready")
open_project(cdp, A_B64, "req071-A")
time.sleep(1.5)  # 冷启动异步读盘
txt = composer_text(cdp)
print(f"[cold-start] 打开 A composer: {txt!r}")
if MARKER in (txt or ""):
    print("✅ PASS:冷启动从盘读回草稿(再水合修改未回归冷启动路径)")
    sys.exit(0)
print("❌ FAIL:冷启动没读回草稿")
sys.exit(1)
