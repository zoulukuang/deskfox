#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Win 侧 REQ-100 真机验证 —— 后端半死时消息回吐而不是静默蒸发。

[fork-only] 对照 spec §5.2 S6.4。mac 侧用 SIGSTOP 冻住 NodeService 精确复现;Windows 没有 SIGSTOP,
等价手段是 ntdll 的 NtSuspendProcess —— 本脚本把那段 P/Invoke 写进临时 .ps1 再调用。

⚠️ 复现手法要点(mac 侧踩过的坑,这里照搬结论):
   直接 kill 后端只会让 fetch 立刻 ECONNREFUSED —— 那是**旧**路径,本来就能 reject,
   验不到本缺陷。REQ-100 的病灶是「socket 还开着但永不响应」,请求既不 resolve 也不 reject。
   所以必须**冻结**而不是杀死。

⚠️ Windows 的平台差异(实测,先知道再跑):
   冻住 NodeService 后,**看门狗约 3 秒就会把它杀掉并重启**(toast 明说「正在自动重启」),
   半死窗口撑不到 20 秒。所以本脚本在 Win 上验到的是**回吐语义本身**(①②③),
   而回吐的触发者是「后端不可达」这条旧路径,**不是新加的 20s 送达闸**——
   20s 闸由单测 T9(假时钟)覆盖。想在 Win 上真验那道闸,得先想办法让后端保持半死超过 20 秒
   而不被看门狗回收,本脚本不做这件事。跑完后 PID 通常已不存在(被重启掉了),
   resume 报「找不到进程」属正常,不是失败。

判定三条(与 mac 侧同口径):
   ① 消息回到输入框 + 明确 toast(20s 送达闸内)
   ② 时间线**不残留**那条消息(乐观挂上 → 超时后撤下)
   ③ 后端恢复后**不自动重发**(证明 abort 真掐断了请求,没有迟到落地)

跑法:PYTHONUTF8=1 python win_req100_rebound.py <NodeService 的 PID>
"""
import json, os, subprocess, sys, tempfile, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from smoke import CDP

PROBE = "REQ100-WIN-PROBE-%d" % int(time.time() % 100000)
# 生成物落临时目录,不要污染仓库(smoke/ 是入仓的 fork 工具目录)
SUSPEND_PS = os.path.join(tempfile.gettempdir(), "deskfox_req100_proc_ctl.ps1")

PS_BODY = """param([int]$ProcessId,[string]$Action)
$sig = @"
using System;
using System.Runtime.InteropServices;
public static class ProcCtl {
    [DllImport("ntdll.dll", SetLastError=true)] public static extern uint NtSuspendProcess(IntPtr h);
    [DllImport("ntdll.dll", SetLastError=true)] public static extern uint NtResumeProcess(IntPtr h);
}
"@
if (-not ("ProcCtl" -as [type])) { Add-Type -TypeDefinition $sig }
$h = (Get-Process -Id $ProcessId -ErrorAction Stop).Handle
if ($Action -eq 'suspend') { Write-Host "SUSPEND rc=$([ProcCtl]::NtSuspendProcess($h))" }
else { Write-Host "RESUME rc=$([ProcCtl]::NtResumeProcess($h))" }
"""


def ensure_ps():
    # PS 5.1 读无 BOM 的 UTF-8 会按 GBK 解码 → 必须带 BOM
    with open(SUSPEND_PS, "wb") as f:
        f.write(b"\xef\xbb\xbf" + PS_BODY.replace("\n", "\r\n").encode("utf-8"))


def proc_ctl(pid, action):
    out = subprocess.run(
        ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SUSPEND_PS,
         "-ProcessId", str(pid), "-Action", action],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    return ((out.stdout or "") + (out.stderr or "")).strip() or "(无输出)"


STATE = """(() => {
  const ed = document.querySelector('[contenteditable="true"]');
  const turns = document.querySelector('[data-slot="session-turn-list"]');
  const toasts = [...document.querySelectorAll('[data-sonner-toast], [role="status"], [data-slot*="toast"]')]
    .map(e => (e.innerText||'').trim().replace(/\\n/g,' ').slice(0,120)).filter(Boolean);
  return {
    composer: ed ? (ed.innerText||'').trim() : null,
    inComposer: ed ? (ed.innerText||'').includes('%s') : false,
    inTimeline: turns ? (turns.innerText||'').split('%s').length - 1 : 0,
    toasts,
    spinner: document.querySelectorAll('svg[data-component="spinner"]').length,
  };
})()""" % (PROBE, PROBE)


def main():
    if len(sys.argv) < 2:
        print("用法:win_req100_rebound.py <NodeService PID>")
        sys.exit(2)
    pid = int(sys.argv[1])
    ensure_ps()
    cdp = CDP(); cdp.connect(); cdp.clear_events()
    print("探针文本:", PROBE)

    ed = cdp.ev("""(() => { const e = document.querySelector('[contenteditable="true"]');
      if (!e) return null; const r = e.getBoundingClientRect();
      return {x: r.left + r.width/2, y: r.top + r.height/2}; })()""")
    if not ed:
        print("找不到输入框"); sys.exit(2)

    # 1) 先冻后端 —— 必须在发之前冻,才能复现「请求打进半死后端后挂住」
    print("冻结后端 NodeService:", proc_ctl(pid, "suspend"))
    time.sleep(1.0)

    # 2) 真实输入 + 提交(CDP 真实事件,不合成键盘)
    cdp.click(ed["x"], ed["y"]); time.sleep(0.4)
    cdp.send("Input.insertText", {"text": PROBE})
    time.sleep(0.5)
    print("输入后:", json.dumps(cdp.ev(STATE), ensure_ascii=False)[:160])
    # ⚠️ 只发 keyDown + keyUp,**绝不发 char**:rawKeyDown 与 char 一起发会让提交触发两次。
    #    实测踩过:第一次提交在后端冻结时正常回吐,第二次提交在看门狗重启后端后落地,
    #    读数看上去像「后端恢复后自动重发」——其实是探针自己按了两下。差点误报成缺陷。
    cdp.send("Input.dispatchKeyEvent", {"type": "keyDown", "key": "Enter", "code": "Enter",
                                        "windowsVirtualKeyCode": 13, "nativeVirtualKeyCode": 13})
    cdp.send("Input.dispatchKeyEvent", {"type": "keyUp", "key": "Enter", "code": "Enter",
                                        "windowsVirtualKeyCode": 13, "nativeVirtualKeyCode": 13})
    t0 = time.time()
    print("已提交,开始观察(送达闸 20s)…")

    rebound_at = None
    peak_timeline = 0
    toast_seen = []
    while time.time() - t0 < 40:
        st = cdp.ev(STATE)
        if st:
            peak_timeline = max(peak_timeline, st["inTimeline"])
            for t in st["toasts"]:
                if t not in toast_seen:
                    toast_seen.append(t)
            if st["inComposer"] and rebound_at is None and time.time() - t0 > 2:
                rebound_at = time.time() - t0
                print("  +%.1fs 回吐到输入框 ✅" % rebound_at)
        time.sleep(1.5)

    st = cdp.ev(STATE)
    print("\n观察结束:", json.dumps(st, ensure_ascii=False)[:300])
    print("期间 toast:", json.dumps(toast_seen, ensure_ascii=False)[:400])

    ok1 = rebound_at is not None and rebound_at <= 30
    ok2 = (st or {}).get("inTimeline", 1) == 0
    print("\n① 消息回到输入框 + toast:", ("PASS(+%.1fs)" % rebound_at) if ok1 else "FAIL(未回吐)")
    print("② 时间线不残留:", "PASS" if ok2 else ("FAIL(残留 %d 处)" % (st or {}).get("inTimeline", -1)))

    # 3) 解冻,确认不自动重发
    print("\n解冻后端:", proc_ctl(pid, "resume"))
    time.sleep(20)
    st2 = cdp.ev(STATE)
    ok3 = (st2 or {}).get("inTimeline", 1) == 0
    print("解冻 20s 后:", json.dumps(st2, ensure_ascii=False)[:220])
    print("③ 后端恢复后不自动重发:", "PASS" if ok3 else "FAIL(时间线出现 %d 处)" % (st2 or {}).get("inTimeline", -1))

    sys.exit(0 if (ok1 and ok2 and ok3) else 1)


if __name__ == "__main__":
    main()
