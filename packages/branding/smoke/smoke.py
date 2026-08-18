# [fork-only] DeskFox 全量冒烟测试引擎(CDP 驱动)
#
# 目的:很多 bug(GetBot 点连接整屏崩、Office .docx 预览空白)只有"真去点一遍"才暴露,
#       单测 / 类型检查 / "代码在不在" 都抓不到。本引擎连上正在运行的 DeskFox(CDP 9222),
#       系统化地把【每个供应商的连接弹窗 / 每种文件类型的预览 / 每个面板与设置页】点一遍,
#       全程捕获 渲染崩溃(error.tsx 错误页)/ 未捕获异常 / console.error,出一张问题清单。
#
# 设计要点:
#   - 只用 CDP 真实输入(Input.dispatchMouseEvent 点击 / dispatchKeyEvent 按 Esc),
#     绝不用 JS 合成键盘事件(会漏进输入框误触发对话,2026-06-13 踩过坑)。
#   - 每个 probe 自洽:自己打开所需界面、跑断言、用 Esc 收尾;崩了就 reload 复位再继续。
#   - 崩溃检测:error.tsx 全屏错误页(有「重启」按钮 + 全屏容器)+ Runtime.exceptionThrown。
#   - 产出:smoke-report.json(结构化)+ smoke-report.md(人读问题清单)。
#
# 用法:先确保 DeskFox dev 版在跑且开了 --remote-debugging-port=9222,然后:
#   python packages/branding/smoke/smoke.py [--only providers,panels,settings,files,boot] [--no-boot]
#
# [feat: smoke-test-system] 2026-06-13

import sys, os, json, time, base64, urllib.request, argparse
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
import websocket  # pip install websocket-client

# CDP 端口可配:Win 上 9222 常被别的 Chrome 实例(或用 CDP 驱动浏览器的脚本)先占住,
# 此时连上去点的是别人的页面。用 DESKFOX_CDP 指到 DeskFox 实际监听的端口。
CDP_HOST = os.environ.get("DESKFOX_CDP", "127.0.0.1:9222")
HERE = os.path.dirname(os.path.abspath(__file__))


# ───────────────────────── CDP 客户端 ─────────────────────────
class CDP:
    def __init__(self, host=CDP_HOST):
        self.host = host
        self.ws = None
        self._id = 0
        self.events = []

    def connect(self):
        targets = json.load(urllib.request.urlopen("http://%s/json" % self.host, timeout=5))
        page = next((t for t in targets if t.get("type") == "page" and "renderer/index" in t.get("url", "")), None)
        if not page:
            page = next((t for t in targets if t.get("type") == "page"), None)
        if not page:
            raise RuntimeError("找不到 DeskFox renderer 页面 — app 是否在跑且开了 9222?")
        self.ws = websocket.create_connection(page["webSocketDebuggerUrl"], max_size=80_000_000, suppress_origin=True)
        self.ws.settimeout(2)
        self.send("Runtime.enable")
        self.send("Page.enable")

    def send(self, method, params=None):
        self._id += 1
        mid = self._id
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        while True:
            try:
                msg = json.loads(self.ws.recv())
            except websocket.WebSocketTimeoutException:
                return {}
            if msg.get("id") == mid:
                return msg.get("result", {})
            self._collect(msg)

    def drain(self, seconds=0.6):
        end = time.time() + seconds
        while time.time() < end:
            try:
                msg = json.loads(self.ws.recv())
            except websocket.WebSocketTimeoutException:
                continue
            except Exception:
                break
            self._collect(msg)

    def _collect(self, msg):
        m = msg.get("method")
        if m == "Runtime.exceptionThrown":
            d = msg["params"]["exceptionDetails"]
            txt = d.get("exception", {}).get("description") or d.get("text") or "exception"
            self.events.append({"kind": "exception", "text": txt[:600]})
        elif m == "Runtime.consoleAPICalled" and msg["params"].get("type") == "error":
            args = msg["params"].get("args", [])
            txt = " ".join(str(a.get("value", a.get("description", ""))) for a in args)
            self.events.append({"kind": "console.error", "text": txt[:600]})

    def clear_events(self):
        self.drain(0.2)
        self.events = []

    def take_events(self):
        self.drain(0.5)
        ev = self.events[:]
        self.events = []
        return ev

    def ev(self, expr):
        r = self.send("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True})
        return r.get("result", {}).get("value")

    def click(self, x, y):
        for t in ("mousePressed", "mouseReleased"):
            self.send("Input.dispatchMouseEvent", {"type": t, "x": x, "y": y, "button": "left", "clickCount": 1})
            time.sleep(0.03)

    def esc(self):
        self.send("Input.dispatchKeyEvent", {"type": "rawKeyDown", "key": "Escape", "windowsVirtualKeyCode": 27})
        self.send("Input.dispatchKeyEvent", {"type": "keyUp", "key": "Escape", "windowsVirtualKeyCode": 27})
        time.sleep(0.15)

    def shot(self, path):
        r = self.send("Page.captureScreenshot", {"format": "png"})
        d = r.get("data")
        if d:
            with open(path, "wb") as f:
                f.write(base64.b64decode(d))

    def reload_app(self, wait=8):
        self.ev("location.reload()")
        time.sleep(wait)
        for _ in range(10):
            if self.ev("!!document.querySelector('header')"):
                break
            time.sleep(1)


IS_CRASHED_JS = r"""
(() => {
  const btns = [...document.querySelectorAll('button')].map(b => (b.textContent||'').trim());
  const restart = btns.includes('重启') || btns.includes('Restart');
  const report = btns.some(t => /上报错误|Export Logs|Report a Bug/.test(t));
  const full = !!document.querySelector('div.h-screen.w-screen, div.relative.flex-1.h-screen');
  return !!(restart && (report || full));
})()
"""


def is_crashed(cdp):
    try:
        return bool(cdp.ev(IS_CRASHED_JS))
    except Exception:
        return False


class Result:
    def __init__(self, group, name):
        self.group = group
        self.name = name
        self.status = "pass"
        self.detail = ""
        self.errors = []

    def to_dict(self):
        return {"group": self.group, "name": self.name, "status": self.status,
                "detail": self.detail, "errors": self.errors}


RESULTS = []


def record(r):
    RESULTS.append(r)
    tag = {"pass": "[PASS]", "fail": "[WARN]", "crash": "[CRASH]", "skip": "[SKIP]"}[r.status]
    print("  %s [%s] %s %s" % (tag, r.group, r.name, ("- " + r.detail) if r.detail else ""), flush=True)
    for e in r.errors[:3]:
        print("       . %s: %s" % (e["kind"], e["text"][:140]), flush=True)


def _skip(group, name, detail):
    r = Result(group, name)
    r.status, r.detail = "skip", detail
    return r


# ───────────────────────── 界面助手 ─────────────────────────
def open_settings(cdp):
    # 已经在设置里就直接返回(避免重复点把它关掉)
    if has_providers_page(cdp):
        return True
    for _ in range(3):
        g = cdp.ev(r"""(()=>{const b=[...document.querySelectorAll('button,[role="button"]')]
            .find(b=>/设置|Settings/.test(b.getAttribute('aria-label')||''));
            if(!b)return null;const r=b.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()""")
        if not g:
            time.sleep(0.6)
            continue
        cdp.click(g["x"], g["y"])
        time.sleep(1.0)
        if has_providers_page(cdp):
            return True
    return False


def click_text(cdp, text):
    xy = cdp.ev(r"""(()=>{const t=%s;const el=[...document.querySelectorAll('button,[role="tab"],h2,div,span')]
        .filter(e=>(e.textContent||'').trim()===t && e.getBoundingClientRect().width>0)
        .sort((a,b)=>a.getElementsByTagName('*').length-b.getElementsByTagName('*').length)[0];
        if(!el)return null;const r=el.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()""" % json.dumps(text))
    if not xy:
        return False
    cdp.click(xy["x"], xy["y"])
    time.sleep(0.6)
    return True


def close_all_overlays(cdp):
    for _ in range(3):
        cdp.esc()
    time.sleep(0.2)


def has_providers_page(cdp):
    return bool(cdp.ev(r"""!![...document.querySelectorAll('*')].find(e=>(e.textContent||'').trim()==='提供商')"""))


# ───────────────────────── probe: 启动/控制台 ─────────────────────────
def probe_boot(cdp):
    print("[boot] reload + 捕获启动期报错...", flush=True)
    cdp.clear_events()
    cdp.reload_app(wait=8)
    r = Result("boot", "reload + 启动健康")
    errs = cdp.take_events()
    if is_crashed(cdp):
        r.status, r.detail = "crash", "启动后停在错误页"
    elif errs:
        r.status, r.detail = "fail", "启动期 %d 条报错" % len(errs)
    r.errors = errs
    record(r)


# ───────────────────────── probe: 供应商连接弹窗 ─────────────────────────
ENUM_CONNECT_JS = r"""
(() => {
  const out = [];
  for (const b of [...document.querySelectorAll('button')]) {
    const t = (b.textContent || '').trim();
    if (t !== '连接' && t !== 'Connect') continue;
    const r = b.getBoundingClientRect();
    if (r.width === 0) continue;
    let row = b, name = '';
    for (let i=0;i<6 && row;i++){ row = row.parentElement; if(!row) break;
      const tx=(row.textContent||'').trim();
      if (tx.length>3 && tx.length<70){ name = tx.replace(/连接|Connect|推荐|Recommended/g,'').trim().slice(0,32); break; } }
    out.push({ name: name || ('btn@'+Math.round(r.y)), x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2) });
  }
  return out;
})()
"""


def probe_providers(cdp):
    print("[providers] 打开设置->提供商,逐个点连接...", flush=True)
    if not open_settings(cdp):
        record(_skip("providers", "全部", "打不开设置"))
        return
    if not click_text(cdp, "提供商"):
        record(_skip("providers", "全部", "找不到提供商页"))
        close_all_overlays(cdp)
        return
    time.sleep(0.6)
    btns = cdp.ev(ENUM_CONNECT_JS) or []
    seen, uniq = set(), []
    for b in btns:
        if b["name"] in seen:
            continue
        seen.add(b["name"])
        uniq.append(b)
    print("  发现 %d 个可连接供应商" % len(uniq), flush=True)
    for b in uniq:
        cdp.clear_events()
        cdp.click(b["x"], b["y"])
        time.sleep(0.8)
        r = Result("providers", b["name"])
        if is_crashed(cdp):
            r.status, r.detail = "crash", "点连接整屏崩溃"
            r.errors = cdp.take_events()
            record(r)
            cdp.reload_app(wait=7)
            open_settings(cdp)
            click_text(cdp, "提供商")
            time.sleep(0.5)
            continue
        opened = cdp.ev(r"""(()=>{const d=document.querySelector('[role="dialog"],[data-component*="dialog"]');
            const apiInput=!!document.querySelector('input[placeholder*="API"],input[placeholder*="密钥"],input[placeholder*="Key"]');
            return !!d || apiInput;})()""")
        errs = cdp.take_events()
        if not opened:
            r.status, r.detail = "fail", "点连接没弹出对话框"
        elif errs:
            r.status, r.detail = "fail", "弹出但有 %d 条报错" % len(errs)
        r.errors = errs
        record(r)
        close_all_overlays(cdp)
        if not has_providers_page(cdp):
            open_settings(cdp)
            click_text(cdp, "提供商")
            time.sleep(0.4)
    close_all_overlays(cdp)


# ───────────────────────── probe: 标题栏面板开关 ─────────────────────────
def _btn_xy(cdp, label):
    return cdp.ev(r"""(()=>{const b=[...document.querySelectorAll('header button')].find(b=>(b.getAttribute('aria-label')||'').trim()===%s);if(!b)return null;const r=b.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()""" % json.dumps(label))


def probe_panels(cdp):
    print("[panels] 逐个点标题栏开关按钮...", flush=True)
    close_all_overlays(cdp)
    labels = ["切换侧边栏", "切换文件树", "切换审查", "状态", "新建会话"]
    for lbl in labels:
        xy = _btn_xy(cdp, lbl)
        if not xy:
            record(_skip("panels", lbl, "标题栏没这个按钮"))
            continue
        cdp.clear_events()
        cdp.click(xy["x"], xy["y"])
        time.sleep(0.5)
        r = Result("panels", lbl)
        if is_crashed(cdp):
            r.status, r.detail = "crash", "点击后崩溃"
            r.errors = cdp.take_events()
            record(r)
            cdp.reload_app(wait=7)
            continue
        r.errors = cdp.take_events()
        if r.errors:
            r.status, r.detail = "fail", "%d 条报错" % len(r.errors)
        record(r)
        back = _btn_xy(cdp, lbl)
        if back:
            cdp.click(back["x"], back["y"])
            time.sleep(0.3)


# ───────────────────────── probe: 设置各页 ─────────────────────────
def probe_settings(cdp):
    print("[settings] 逐个切换设置页...", flush=True)
    if not open_settings(cdp):
        record(_skip("settings", "全部", "打不开设置"))
        return
    for tab in ["通用", "快捷键", "服务器", "提供商", "模型", "飞书桥接"]:
        cdp.clear_events()
        ok = click_text(cdp, tab)
        time.sleep(0.5)
        r = Result("settings", tab)
        if not ok:
            r.status, r.detail = "skip", "没这个页"
        elif is_crashed(cdp):
            r.status, r.detail = "crash", "切到此页崩溃"
            r.errors = cdp.take_events()
            record(r)
            cdp.reload_app(wait=7)
            open_settings(cdp)
            continue
        else:
            r.errors = cdp.take_events()
            if r.errors:
                r.status, r.detail = "fail", "%d 条报错" % len(r.errors)
        record(r)
    close_all_overlays(cdp)


# ───────────────────────── probe: 文件预览(可见文件) ─────────────────────────
RENDER_CHECK_JS = r"""
(() => {
  // 只看当前激活的文件查看器(keyed Show 同时只挂一个),不含文件树,避免树文本干扰
  const v = document.querySelector('[data-component="file-viewer"]') || document.querySelector('#review-panel');
  if (!v) return {ok:false, why:'无查看器'};
  const q = s => !!v.querySelector(s);
  const hasCanvas = q('canvas');
  const hasImg = [...v.querySelectorAll('img')].some(i=>i.naturalWidth>0);
  const hasIframe = q('iframe');
  const hasDiffs = q('diffs-container');
  const fallback = [...v.querySelectorAll('button')].some(b=>/用本机软件打开/.test(b.textContent||''));
  const text = (v.textContent||'').replace(/用本机软件打开/g,'').trim();
  return {hasCanvas, hasImg, hasIframe, hasDiffs, fallback, textLen:text.length};
})()
"""

IMG_EXT = {"png", "jpg", "jpeg", "gif", "svg", "webp", "bmp"}
PDFISH_EXT = {"pdf", "docx", "doc", "xlsx", "xls", "pptx", "ppt", "odt", "ods", "odp", "rtf"}
HTML_EXT = {"html", "htm"}


TREE_SCROLLER_JS = r"""(()=>{const t=document.querySelector('#file-tree-panel');if(!t)return null;
  let s=t;for(const e of [t,...t.querySelectorAll('*')]){if(e.scrollHeight>e.clientHeight+20){s=e;break;}}
  return {sh:s.scrollHeight,ch:s.clientHeight};})()"""

VISIBLE_LEAVES_JS = r"""(()=>{const t=document.querySelector('#file-tree-panel');if(!t)return[];
  const out=[];
  [...t.querySelectorAll('*')].forEach(e=>{const tx=(e.textContent||'').trim();
    if(e.children.length>1)return; if(tx.length>80)return; if(!/^[^\n/]+\.[a-z0-9]{1,5}$/i.test(tx))return;
    const r=e.getBoundingClientRect(); if(r.width<40||r.height>40)return;
    if(r.top<70||r.bottom>window.innerHeight-10)return; // 仅视口内、可点
    out.push({name:tx, ext:tx.split('.').pop().toLowerCase(), x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)});});
  return out;})()"""


def probe_files(cdp):
    print("[files] 滚动遍历文件树,逐个打开各类型文件,断言能渲染...", flush=True)
    close_all_overlays(cdp)
    has_tree = cdp.ev(r"""(()=>{const t=document.querySelector('#file-tree-panel');return !!t && t.getBoundingClientRect().width>30;})()""")
    if not has_tree:
        xy = _btn_xy(cdp, "切换文件树")
        if xy:
            cdp.click(xy["x"], xy["y"])
            time.sleep(0.6)
    # FORK: 冷启动后文件夹是折叠的 → 几乎没有叶子文件可测。先展开:自上而下点可见的折叠文件夹
    #   (aria-expanded="false"),边展开边滚动,有上限防失控。
    cdp.ev(r"""(()=>{const t=document.querySelector('#file-tree-panel');if(!t)return;let s=t;for(const e of [t,...t.querySelectorAll('*')]){if(e.scrollHeight>e.clientHeight+20){s=e;break;}}s.scrollTop=0;})()""")
    time.sleep(0.3)
    expanded, stale = 0, 0
    while expanded < 45 and stale < 8:
        xy = cdp.ev(r"""(()=>{const t=document.querySelector('#file-tree-panel');if(!t)return null;
          const el=[...t.querySelectorAll('[aria-expanded="false"]')].find(e=>{const r=e.getBoundingClientRect();return r.top>70 && r.bottom<window.innerHeight-10 && r.width>20;});
          if(!el)return null;const r=el.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()""")
        if xy:
            cdp.click(xy["x"], xy["y"])
            expanded += 1
            stale = 0
            time.sleep(0.2)
        else:
            atBottom = cdp.ev(r"""(()=>{const t=document.querySelector('#file-tree-panel');let s=t;for(const e of [t,...t.querySelectorAll('*')]){if(e.scrollHeight>e.clientHeight+20){s=e;break;}}
              const was=s.scrollTop; s.scrollTop=Math.min(s.scrollTop+s.clientHeight*0.7, s.scrollHeight); return s.scrollTop<=was+2;})()""")
            stale += 1
            time.sleep(0.25)
            if atBottom:
                break
    print("  展开了 ~%d 个文件夹" % expanded, flush=True)
    cdp.ev(r"""(()=>{const t=document.querySelector('#file-tree-panel');if(!t)return;let s=t;for(const e of [t,...t.querySelectorAll('*')]){if(e.scrollHeight>e.clientHeight+20){s=e;break;}}s.scrollTop=0;})()""")
    time.sleep(0.3)

    sc = cdp.ev(TREE_SCROLLER_JS)
    if not sc:
        record(_skip("files", "文件树", "找不到可滚动文件树"))
        return
    # FORK: 文件树是虚拟列表(只渲染视口内行)+ 很长 → 必须滚动分页遍历。否则视口外文件点不到、
    #   读到上一个文件的查看器 → 误判(html/xlsx 等曾因此误报)。每种扩展名最多测 PER_EXT 个。
    step = max(200, int(sc["ch"] * 0.8))
    processed: set = set()
    seen_ext: dict = {}
    PER_EXT = 2
    pos = 0
    while pos <= sc["sh"] + step:
        cdp.ev(r"""(()=>{const t=document.querySelector('#file-tree-panel');if(!t)return;
          let s=t;for(const e of [t,...t.querySelectorAll('*')]){if(e.scrollHeight>e.clientHeight+20){s=e;break;}}
          s.scrollTop=%d;})()""" % int(pos))
        time.sleep(0.5)
        for f in cdp.ev(VISIBLE_LEAVES_JS) or []:
            name = f["name"]
            if name in processed:
                continue
            processed.add(name)
            ext = f["ext"]
            if seen_ext.get(ext, 0) >= PER_EXT:
                continue
            # 重新按名取当前坐标(确认仍在视口),再点 —— 防止枚举后行被滚走
            xy = cdp.ev(
                r"""(()=>{const t=document.querySelector('#file-tree-panel');if(!t)return null;
                  const n=%s;const el=[...t.querySelectorAll('*')].find(e=>e.children.length<=1 && (e.textContent||'').trim()===n);
                  if(!el)return null;const r=el.getBoundingClientRect();
                  if(r.top<70||r.bottom>window.innerHeight-10||r.width<10)return null;
                  return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()""" % json.dumps(name)
            )
            if not xy:
                continue
            seen_ext[ext] = seen_ext.get(ext, 0) + 1
            cdp.clear_events()
            cdp.click(xy["x"], xy["y"])
            time.sleep(1.0)
            r = Result("files", name)
            if is_crashed(cdp):
                r.status, r.detail = "crash", "打开即崩溃"
                r.errors = cdp.take_events()
                record(r)
                cdp.reload_app(wait=7)
                continue
            # FORK: 轮询等待渲染 —— office 首次转换(LibreOffice 冷启动)/大 PDF 渲染较慢,
            #   固定 wait 会误判空白。pdf-like 等 canvas 最多 ~22s,html 等 iframe ~6s。
            chk = cdp.ev(RENDER_CHECK_JS) or {}
            if ext in PDFISH_EXT:
                for _ in range(20):
                    if chk.get("hasCanvas"):
                        break
                    time.sleep(1.1)
                    chk = cdp.ev(RENDER_CHECK_JS) or {}
            elif ext in HTML_EXT:
                for _ in range(6):
                    if chk.get("hasIframe"):
                        break
                    time.sleep(0.8)
                    chk = cdp.ev(RENDER_CHECK_JS) or {}
            ok, why = _assert_render(ext, chk)
            r.errors = cdp.take_events()
            if not ok:
                r.status, r.detail = "fail", why
            elif r.errors:
                r.status, r.detail = "fail", "渲染了但有 %d 条报错" % len(r.errors)
            record(r)
        pos += step


def _assert_render(ext, chk):
    if not chk:
        return False, "查看器无响应"
    if ext in PDFISH_EXT:
        if chk.get("hasCanvas"):
            return True, ""
        return False, ("空白(只有'用本机软件打开',无 PDF 画布)" if chk.get("fallback") else "无 PDF 画布")
    if ext in IMG_EXT:
        return (chk.get("hasImg"), "" if chk.get("hasImg") else "图片未渲染")
    if ext in HTML_EXT:
        return (chk.get("hasIframe"), "" if chk.get("hasIframe") else "HTML iframe 缺失")
    if chk.get("hasDiffs") or chk.get("textLen", 0) > 20:
        return True, ""
    return False, "内容为空"


# ───────────────────────── 报告 ─────────────────────────
def write_reports():
    by_status = {}
    for r in RESULTS:
        by_status.setdefault(r.status, []).append(r)
    summary = {k: len(v) for k, v in by_status.items()}
    payload = {"summary": summary, "results": [r.to_dict() for r in RESULTS]}
    with open(os.path.join(HERE, "smoke-report.json"), "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    lines = ["# DeskFox 全量冒烟测试 — 问题清单", "",
             "- 通过 %d / 警告 %d / 崩溃 %d / 跳过 %d" % (
                 summary.get("pass", 0), summary.get("fail", 0), summary.get("crash", 0), summary.get("skip", 0)),
             "- 总计 %d 项" % len(RESULTS), ""]
    for st, title in [("crash", "崩溃(最高优先级)"), ("fail", "异常/空白/报错"), ("skip", "跳过(未覆盖)")]:
        items = by_status.get(st, [])
        if not items:
            continue
        lines.append("## %s — %d 项" % (title, len(items)))
        for r in items:
            lines.append("- **[%s] %s** — %s" % (r.group, r.name, r.detail))
            for e in r.errors[:2]:
                lines.append("  - `%s`: %s" % (e["kind"], e["text"][:160]))
        lines.append("")
    lines.append("## 通过项")
    lines.append("、".join("[%s]%s" % (r.group, r.name) for r in by_status.get("pass", [])) or "(无)")
    with open(os.path.join(HERE, "smoke-report.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print("\n报告已写出:", os.path.join(HERE, "smoke-report.md"), flush=True)


ALL_PROBES = {
    "boot": probe_boot,
    "providers": probe_providers,
    "panels": probe_panels,
    "settings": probe_settings,
    "files": probe_files,
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--no-boot", action="store_true")
    args = ap.parse_args()
    only = [x for x in args.only.split(",") if x] or list(ALL_PROBES.keys())
    if args.no_boot and "boot" in only:
        only.remove("boot")

    cdp = CDP()
    cdp.connect()
    print("已连接 DeskFox CDP。将运行 probe: %s\n" % only, flush=True)
    for name in only:
        try:
            ALL_PROBES[name](cdp)
        except Exception as e:
            print("  !! probe %s 引擎异常: %s" % (name, e), flush=True)
            record(_skip(name, "(probe引擎)", "异常 %s" % e))
            try:
                if is_crashed(cdp):
                    cdp.reload_app(wait=7)
            except Exception:
                pass
    close_all_overlays(cdp)
    write_reports()
    cdp.ws.close()


if __name__ == "__main__":
    main()
