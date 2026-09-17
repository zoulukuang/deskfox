#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Win 侧 REQ-128 真机验证 —— 工具折叠行命中区收窄到文字区。

[fork-only] 对照 spec §5.2 S6.5 的「工具行右侧空白点不开」。mac 侧已用 CDP 实点验过
(960px 行 / 126px trigger),本脚本是 Windows 侧的同口径复验。

判定口径(与 mac 侧一致,量化而非目测):
  ① 点 trigger 右侧死区  → aria-expanded 不变        —— 修复前整行可点,这里会被展开
  ② 点 trigger 文字区    → aria-expanded false→true   —— 收窄不能收过头,该点的地方要还能点
  ③ 再点一次文字区收回   → true→false                 —— 不是单向的

跑法:先用 --remote-debugging-port=9222 起「DeskFox 本地版.exe」并打开一个含工具调用的会话,
再 PYTHONUTF8=1 python win_req128_hitarea.py
"""
import json, sys, os, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from smoke import CDP

ROWS = '[...document.querySelectorAll(\'[data-component="collapsible"].tool-collapsible\')]'

R = []


def rec(name, ok, detail=""):
    R.append(ok)
    print(("  [PASS] " if ok else "  [FAIL] ") + name + ("  " + detail if detail else ""))


def geom(cdp, i):
    """把第 i 个工具行滚进视野,返回行与 trigger 的几何 + 当前展开态"""
    cdp.ev(
        "(() => { const r = %s[%d]; if (r) r.scrollIntoView({block:'center'}); })()" % (ROWS, i)
    )
    time.sleep(0.6)
    return cdp.ev(
        """(() => {
      const row = %s[%d]; if (!row) return null;
      const t = row.querySelector('[data-slot="collapsible-trigger"]'); if (!t) return null;
      const rr = row.getBoundingClientRect(), tr = t.getBoundingClientRect();
      if (tr.top < 60 || tr.bottom > innerHeight - 40) return null;   // 没滚好,别在边缘点
      return {
        label: (t.innerText||'').trim().slice(0,24).replace(/\\n/g,' '),
        rowLeft: rr.left, rowRight: rr.right, rowW: rr.width,
        trigLeft: tr.left, trigRight: tr.right, trigW: tr.width,
        y: tr.top + tr.height/2,
        expanded: t.getAttribute('aria-expanded'),
      };
    })()"""
        % (ROWS, i)
    )


def expanded(cdp, i):
    return cdp.ev(
        "(() => { const r = %s[%d]; const t = r && r.querySelector('[data-slot=\"collapsible-trigger\"]');"
        " return t ? t.getAttribute('aria-expanded') : null; })()" % (ROWS, i)
    )


def click(cdp, x, y):
    cdp.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": y})
    time.sleep(0.25)
    cdp.click(x, y)
    time.sleep(0.9)


def main():
    cdp = CDP()
    cdp.connect()
    cdp.clear_events()
    n = cdp.ev("(() => %s.length)()" % ROWS)
    print("工具折叠行数量:", n)
    if not n:
        print("当前会话没有工具调用行 —— 请先打开一个含工具调用的会话")
        sys.exit(2)

    tested = 0
    for i in range(n):
        g = geom(cdp, i)
        if not g:
            continue
        # 死区必须足够宽才有意义(否则这一行本来就没有右侧空白)
        dead = g["rowRight"] - g["trigRight"]
        if dead < 60:
            print("  (第 %d 行 trigger 几乎占满整行,无右侧死区可测,跳过)" % i)
            continue
        pct = round(g["trigW"] / g["rowW"] * 100)
        print(
            "\n== 第 %d 行「%s」 行宽 %d / trigger 宽 %d(占 %d%%)/ 右侧死区 %d px =="
            % (i, g["label"], g["rowW"], g["trigW"], pct, dead)
        )

        before = expanded(cdp, i)
        click(cdp, g["trigRight"] + dead / 2, g["y"])          # ① 死区
        after_dead = expanded(cdp, i)
        rec("① 点右侧死区不展开", after_dead == before,
            "x=%d(trigger 右边界 %d) aria-expanded %s→%s" % (g["trigRight"] + dead / 2, g["trigRight"], before, after_dead))

        click(cdp, g["trigLeft"] + min(30, g["trigW"] / 2), g["y"])   # ② 文字区
        after_text = expanded(cdp, i)
        rec("② 点文字区能展开", after_text != after_dead,
            "aria-expanded %s→%s" % (after_dead, after_text))

        g2 = geom(cdp, i)
        if g2:
            click(cdp, g2["trigLeft"] + min(30, g2["trigW"] / 2), g2["y"])  # ③ 再点收回
            rec("③ 再点文字区能收回", expanded(cdp, i) == after_dead,
                "aria-expanded %s→%s" % (after_text, expanded(cdp, i)))
        tested += 1
        if tested >= 2:
            break

    if not tested:
        print("没有可测的行(都没有右侧死区)")
        sys.exit(2)
    ev = [e for e in cdp.take_events() if e["kind"] in ("exception", "console.error")]
    rec("全程无渲染异常 / console.error", len(ev) == 0, json.dumps(ev, ensure_ascii=False)[:200] if ev else "")
    bad = len([x for x in R if not x])
    print("\n== 小结:%d/%d 通过 ==" % (len(R) - bad, len(R)))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
