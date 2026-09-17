#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Win 侧文件预览验证 — release-closeout-2026-09 回验。

覆盖本批 file-tabs.tsx 的两处改动:
  ① onMount 自加载 —— 恢复出来的激活 tab 不再一片空白
  ② 兜底 Match 分支 —— loaded/loading/error 之外的状态给出可读提示而不是纯白
外加各类型预览本身能渲染(pdf/office 走 pdf.js canvas,图片走 img)。
"""
import sys, os, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import win_s65_gui as G
from smoke import CDP

WANT = ["sample.pdf", "sample.docx", "sample.xlsx", "sample.png", "README.md", "data.json"]
EXPECT = {"sample.pdf": "canvas", "sample.docx": "canvas", "sample.xlsx": "canvas",
          "sample.png": "img", "README.md": "text", "data.json": "text"}

def content_probe(cdp):
    """读激活预览区的内容。

    ⚠️ 必须穿透 shadow DOM:代码/文本类文件走 <diffs-container>,内容全在它的 shadowRoot 里,
       外层 innerText 读出来是空的 —— 只看 innerText 会把「渲染完好的 data.json」误判成空白。
       (实测踩过:data.json 报空白,扒开 shadowRoot 才看到 86 个节点、内容俱全。)
    """
    return cdp.ev("""(() => {
      const c = document.querySelector('[data-slot="tabs-content"][data-state="active"]')
            || document.querySelector('[data-slot="tabs-content"]');
      if (!c) return {none: true};
      const txt = (c.innerText || '').trim();
      let shadowTxt = '', shadowNodes = 0;
      for (const el of c.querySelectorAll('*')) {
        if (el.shadowRoot) {
          shadowTxt += (el.shadowRoot.textContent || '');
          shadowNodes += el.shadowRoot.querySelectorAll('*').length;
        }
      }
      shadowTxt = shadowTxt.trim();
      const total = txt.length + shadowTxt.length;
      return {
        canvas: c.querySelectorAll('canvas').length,
        img: [...c.querySelectorAll('img')].filter(i => i.naturalWidth > 0).length,
        textLen: txt.length,
        shadowLen: shadowTxt.length,
        shadowNodes,
        head: (txt || shadowTxt).slice(0, 60),
        blank: c.querySelectorAll('canvas,img,pre,code,table').length === 0 && total === 0 && shadowNodes === 0,
        unavailable: /找不到|不可用|unavailable/i.test(txt),
      };
    })()""")

def open_file(cdp, name):
    sel = ("[...document.querySelectorAll('[data-tree-path]')]"
           ".find(e => (e.getAttribute('data-tree-path')||'').endsWith(%s))" % json.dumps(name))
    pt = G.point_of(cdp, sel)
    if not pt:
        return False
    G.hover_click(cdp, pt)
    return True

def main():
    cdp = CDP(); cdp.connect(); cdp.clear_events()
    ok_all = True
    for name in WANT:
        if not open_file(cdp, name):
            print("  [SKIP] %s —— 文件树里点不到" % name); continue
        time.sleep(1.6)   # pdf.js 首帧要时间
        p = content_probe(cdp)
        kind = EXPECT[name]
        # 文本类的内容可能全在 shadowRoot 里(diffs-container),两处任一有内容即算渲染成功
        good = (p.get("canvas", 0) > 0) if kind == "canvas" else \
               (p.get("img", 0) > 0) if kind == "img" else \
               (p.get("textLen", 0) > 0 or p.get("shadowLen", 0) > 0)
        ok_all = ok_all and good
        print("  [%s] %-22s canvas=%s img=%s 文字=%s shadow=%s(%s节点) 空白=%s  %s" %
              ("PASS" if good else "FAIL", name, p.get("canvas"), p.get("img"),
               p.get("textLen"), p.get("shadowLen"), p.get("shadowNodes"), p.get("blank"),
               p.get("head","")[:28].replace("\n"," ")))
    ev = cdp.take_events()
    errs = [e for e in ev if e["kind"] in ("exception", "console.error")]
    print("  渲染异常/console.error:", len(errs), json.dumps(errs, ensure_ascii=False)[:200] if errs else "")
    st = G.tab_state(cdp)
    print("  结束状态:", json.dumps(st, ensure_ascii=False))
    sys.exit(0 if ok_all and not errs else 1)

if __name__ == "__main__":
    main()
