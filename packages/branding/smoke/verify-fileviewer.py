# [fork-only] DeskFox 文件预览(PDF/Office/图片)全自动渲染验证
# 前提:固定测试项目 D:\tmp\deskfox-doc-test 已是 DeskFox 已知项目(侧边栏有它),样本固定全 git tracked。
#       重建夹具见 docs/governance/Windows-适配性全自动测试-SOP.md。
# 用法:DeskFox dev 版带 --remote-debugging-port=9222 跑起来后:
#       python packages/branding/smoke/verify-fileviewer.py
# 原理:CDP 点侧边栏 'deskfox-doc-test' 图标打开项目(纯 CDP,无 native 对话框)→ 等文件树出样本
#       → 逐个点开验渲染。pdf/docx/xlsx 走 pdf.js canvas(office 经内嵌 LibreOffice 转 PDF),png 走 img。
import sys, time, json
sys.path.insert(0, r"D:\project\opencode-fork\packages\branding\smoke")
import smoke

c = None
for _ in range(40):
    try: c = smoke.CDP(); c.connect(); break
    except Exception: time.sleep(1)
if not c: print("FAIL: CDP 连不上(DeskFox 没起或没开 9222?)"); sys.exit(2)

# 1) 点侧边栏项目图标打开测试项目
# 注意:用 for-loop 遍历 NodeList,不要用 [...querySelectorAll()].map/.filter —— 该 renderer 下
#       NodeList 的 spread+map 写法会让 Runtime.evaluate 稳定挂起(CDP 2s 超时返回 {}),for-loop 正常。
#       (2026-06-21 实测定论:spread+map over [data-tree-path] 必挂,for-loop 必通)
FIND = r'''(()=>{const bs=document.querySelectorAll('button,[role=button],a');for(let i=0;i<bs.length;i++){const b=bs[i];const r=b.getBoundingClientRect();if(r.x<70&&r.width>14&&(b.getAttribute('aria-label')||'').trim()==='deskfox-doc-test'){return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});}}return null;})()'''
xy = None
for _ in range(40):
    v = c.ev(FIND)
    if v and v != "null": xy = json.loads(v); break
    time.sleep(1)
if not xy: print("FAIL: 侧边栏找不到 'deskfox-doc-test' 图标"); sys.exit(2)
c.click(xy["x"], xy["y"]); time.sleep(2)
print("已点击侧边栏项目 deskfox-doc-test", flush=True)

# 2) 等文件树出现样本
DETECT = r'''(()=>{const re=/^sample\.(pdf|docx|xlsx|png)$/;const o=[];const e=document.querySelectorAll('[data-tree-path]');for(let i=0;i<e.length;i++){const p=e[i].getAttribute('data-tree-path');if(re.test(p))o.push(p);}return JSON.stringify(o);})()'''
samples = []
for _ in range(30):
    samples = json.loads(c.ev(DETECT) or "[]")
    if len(samples) >= 3: break
    time.sleep(1)
if len(samples) < 3: print("FAIL: 文件树未出现样本"); sys.exit(2)
print("文件树样本就绪:", samples, flush=True)

# 3) 逐个点开验渲染
specs = [("sample.pdf","pdf"),("sample.docx","docx"),("sample.xlsx","xlsx"),("sample.png","png")]
results = []
for name, ext in specs:
    c.esc(); time.sleep(0.3)
    xy = c.ev(r'''(()=>{const el=document.querySelector('[data-tree-path="''' + name + r'''"]');if(!el)return null;const r=el.getBoundingClientRect();if(r.width<10)return null;return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});})()''')
    if not xy or xy == "null":
        results.append((name, False)); print("  [FAIL] %s 文件树无此行" % name, flush=True); continue
    p = json.loads(xy); c.clear_events(); c.click(p["x"], p["y"]); time.sleep(1.0)
    chk = c.ev(smoke.RENDER_CHECK_JS) or {}
    if ext in smoke.PDFISH_EXT:
        for _ in range(25):
            if chk.get("hasCanvas"): break
            time.sleep(1.1); chk = c.ev(smoke.RENDER_CHECK_JS) or {}
    elif ext in smoke.IMG_EXT:
        for _ in range(8):
            if chk.get("hasImg"): break
            time.sleep(0.6); chk = c.ev(smoke.RENDER_CHECK_JS) or {}
    ok, why = smoke._assert_render(ext, chk)
    errs = c.take_events()
    if ok and errs: ok, why = False, "渲染了但有 %d 条报错" % len(errs)
    results.append((name, ok))
    print("  [%s] %s  %s" % ("PASS" if ok else "FAIL", name, why or ""), flush=True)
c.esc()
n = sum(1 for r in results if r[1])
print("=== 文件预览渲染: %d/%d PASS ===" % (n, len(specs)), flush=True)
sys.exit(0 if n == len(specs) else 1)
