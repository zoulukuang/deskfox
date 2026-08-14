# [fork-only] Windows 原生层探测 —— UIAutomation 后端 [feat: upstream-sync-2026-08] 2026-08-14
#
# 供 `uiprobe_native.py` 的 WinNative 调用,只做三件 ctypes 做不了的事:
#   dialogs  列出进程的原生对话框(标题/正文/按钮名)
#   click    按名字点对话框按钮
#   menu     导出菜单栏树(顶层项 + 子项),用于中文化校验
#
# 为什么必须 UIA 而不是 GetWindowText:
#   Electron 在 Windows 走 TaskDialogIndirect,对话框正文与按钮渲染在 DirectUI 内部,
#   EnumChildWindows + WM_GETTEXT 读到的是空 —— 会把「有对话框」误判成「没对话框」,
#   而这恰好是崩溃恢复/更新器那几条用例的判定依据,读错就等于测了个寂寞。
#
# 输出:单行 JSON 到 stdout(失败输出 null)。所有诊断信息走 stderr,不污染 JSON。
#
# 🔴 本文件**必须存为 UTF-8 with BOM**。Windows PowerShell 5.1 读无 BOM 的 .ps1 时按系统
#    ANSI(中文机上是 GBK)解码,上面这些中文注释会被打乱,乱码里的字节可能吃掉注释边界
#    → 整个脚本语法错误、一行都跑不了。2026-08-14 实撞:表现是每个 verb 都返回空列表,
#    看着像「UIA 树里没有对话框/菜单」,极易被当成产品缺陷去查(差点据此写下错误结论)。
#    编辑本文件后如用不带 BOM 的工具保存,请补回 BOM:
#      $t=[IO.File]::ReadAllText($p,[Text.UTF8Encoding]::new($false))
#      [IO.File]::WriteAllText($p,$t,[Text.UTF8Encoding]::new($true))

param(
    [Parameter(Mandatory = $true)][string]$Verb,
    [Parameter(Mandatory = $true)][string]$Process,
    [string]$Arg = ""
)

$ErrorActionPreference = "Stop"
# stdout 与 stderr 都要显式设 UTF-8:调用方按 utf-8 解码,
# 漏设 stderr 会让一句中文诊断信息把整个工具调用打挂(2026-08-14 实撞)。
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

try {
    Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes -ErrorAction Stop
} catch {
    [Console]::Error.WriteLine("[uia] 加载 UIAutomation 程序集失败: $($_.Exception.Message)")
    Write-Output "null"
    exit 0
}

$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]
$CT = [System.Windows.Automation.ControlType]

# 进程名可传 "DeskFox 本地版" 或带 .exe;Get-Process 要的是不带扩展名的
$procName = [System.IO.Path]::GetFileNameWithoutExtension($Process)
$procs = @(Get-Process -Name $procName -ErrorAction SilentlyContinue)
if ($procs.Count -eq 0) {
    [Console]::Error.WriteLine("[uia] 进程未运行: $procName")
    Write-Output "null"
    exit 0
}

# ── 取该进程的全部顶层窗口 ───────────────────────────────────────
# Electron 一个应用会有多个 pid(main + 各 renderer),窗口挂在 main 那个;
# 逐 pid 找一遍,别假设 Get-Process 返回的第一个就是主进程。
function Get-TopWindows {
    $found = New-Object System.Collections.ArrayList
    foreach ($p in $procs) {
        $cond = New-Object System.Windows.Automation.PropertyCondition(
            $AE::ProcessIdProperty, $p.Id)
        try {
            $els = $AE::RootElement.FindAll($TS::Children, $cond)
        } catch { continue }
        foreach ($e in $els) { [void]$found.Add($e) }
    }
    return $found
}

function Get-Descendants($el, $controlType) {
    $cond = New-Object System.Windows.Automation.PropertyCondition(
        $AE::ControlTypeProperty, $controlType)
    try { return $el.FindAll($TS::Descendants, $cond) } catch { return @() }
}

function To-Json($obj) {
    # 两个 PS5.1 特有的坑,都会让调用方拿到形状不对的数据:
    #   ① 默认深度 2 —— 菜单树会被截成字符串 "System.Object[]";
    #   ② **管道传数组时,单元素数组会被拆成对象** —— `@($x) | ConvertTo-Json` 得到的是
    #      `{...}` 而不是 `[{...}]`。2026-08-14 实撞:Python 侧 `len(结果)` 数成了字典的
    #      键个数(5),于是「1 个对话框」被报成「5 个对话框,指代不清」,白排查一轮。
    #      改用 -InputObject 传参可保住数组语义。
    return (ConvertTo-Json -InputObject $obj -Depth 8 -Compress)
}

switch ($Verb) {

    # ── 列出原生对话框 ────────────────────────────────────────
    "dialogs" {
        $out = New-Object System.Collections.ArrayList
        foreach ($w in Get-TopWindows) {
            try {
                $cls = $w.Current.ClassName
                $name = $w.Current.Name
            } catch { continue }

            # #32770 = Win32 对话框类(TaskDialog 也是它);
            # Chrome_WidgetWin_* 里模态的那种靠 WindowPattern.IsModal 认。
            $isModal = $false
            try {
                $wp = $w.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)
                $isModal = $wp.Current.IsModal
            } catch { }
            if ($cls -ne "#32770" -and -not $isModal) { continue }

            # 只算**用户真看得见**的。UIA 会枚举到离屏/隐藏的 #32770(Electron 留的空壳),
            # 而 ctypes 那边按 IsWindowVisible 过滤 —— 两边口径不一致会让同一时刻
            # 一个说「1 个对话框」、一个说「5 个」,进而触发「指代不清」误停。2026-08-14 实撞。
            try { if ($w.Current.IsOffscreen) { continue } } catch { }
            try {
                $r = $w.Current.BoundingRectangle
                if ($r.Width -le 0 -or $r.Height -le 0) { continue }
            } catch { }

            $buttons = @(Get-Descendants $w $CT::Button | ForEach-Object {
                try { $_.Current.Name } catch { $null } } | Where-Object { $_ })
            $texts = @(Get-Descendants $w $CT::Text | ForEach-Object {
                try { $_.Current.Name } catch { $null } } | Where-Object { $_ })

            [void]$out.Add([ordered]@{
                title   = $name
                cls     = $cls
                modal   = $isModal
                text    = ($texts -join " | ")
                buttons = $buttons
            })
        }
        Write-Output (To-Json @($out))
    }

    # ── 点对话框按钮(按名字,支持包含匹配)────────────────────
    "click" {
        $target = $Arg
        foreach ($w in Get-TopWindows) {
            foreach ($b in (Get-Descendants $w $CT::Button)) {
                $bn = ""
                try { $bn = $b.Current.Name } catch { continue }
                if ($target -and $bn -ne $target -and $bn -notlike "*$target*") { continue }
                try {
                    $ip = $b.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
                    $ip.Invoke()
                    Write-Output (To-Json ([ordered]@{ ok = $true; clicked = $bn }))
                    exit 0
                } catch {
                    [Console]::Error.WriteLine("[uia] 按钮「$bn」不支持 Invoke: $($_.Exception.Message)")
                }
            }
        }
        Write-Output (To-Json ([ordered]@{ ok = $false; reason = "未找到可点的按钮「$target」" }))
    }

    # ── 导出菜单栏树 ──────────────────────────────────────────
    # 只读名字,不展开 —— 展开会真的弹菜单,可能吃掉后续按键(Mac 端踩过类似的副作用)。
    "menu" {
        $out = New-Object System.Collections.ArrayList
        foreach ($w in Get-TopWindows) {
            foreach ($bar in (Get-Descendants $w $CT::MenuBar)) {
                $items = @()
                foreach ($mi in (Get-Descendants $bar $CT::MenuItem)) {
                    try { $items += $mi.Current.Name } catch { }
                }
                if ($items.Count -eq 0) { continue }
                [void]$out.Add([ordered]@{
                    window = $w.Current.Name
                    items  = $items
                })
            }
        }
        Write-Output (To-Json @($out))
    }

    # ── 导出对话框内的控件清单(排障用)────────────────────────
    "controls" {
        $out = New-Object System.Collections.ArrayList
        foreach ($w in Get-TopWindows) {
            $cls = ""
            try { $cls = $w.Current.ClassName } catch { continue }
            if ($cls -ne "#32770") { continue }
            $ctrls = @()
            try {
                foreach ($e in $w.FindAll($TS::Descendants,
                        [System.Windows.Automation.Condition]::TrueCondition)) {
                    try {
                        $ctrls += [ordered]@{
                            type = $e.Current.ControlType.ProgrammaticName
                            name = $e.Current.Name
                            id   = $e.Current.AutomationId
                        }
                    } catch { }
                }
            } catch { }
            [void]$out.Add([ordered]@{ title = $w.Current.Name; cls = $cls; controls = $ctrls })
        }
        Write-Output (To-Json @($out))
    }

    # ── 往原生文件对话框填路径并确认 ──────────────────────────
    # 用 ValuePattern.SetValue 而不是模拟键盘:中文路径走键盘要过输入法,
    # 且路径栏可能弹自动补全、回车次数不固定(Mac 端在这上面栽过,见 open_project.py 的 press_until)。
    # 直接设值 + Invoke 默认按钮,把「敲几次回车」这个不确定性整个消掉。
    "openpath" {
        foreach ($w in Get-TopWindows) {
            $cls = ""
            try { $cls = $w.Current.ClassName } catch { continue }
            if ($cls -ne "#32770") { continue }

            $edit = $null
            foreach ($e in (Get-Descendants $w $CT::Edit)) { $edit = $e; break }
            if (-not $edit) {
                Write-Output (To-Json ([ordered]@{ ok = $false; reason = "对话框里没有 Edit 控件" }))
                exit 0
            }
            try {
                $vp = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                $vp.SetValue($Arg)
            } catch {
                Write-Output (To-Json ([ordered]@{ ok = $false; reason = "SetValue 失败: $($_.Exception.Message)" }))
                exit 0
            }
            Start-Sleep -Milliseconds 400

            # 确认按钮名随 Windows 语言/对话框类型变化,逐个候选试
            foreach ($cand in @("选择文件夹", "打开", "确定", "Select Folder", "Open", "OK")) {
                foreach ($b in (Get-Descendants $w $CT::Button)) {
                    $bn = ""
                    try { $bn = $b.Current.Name } catch { continue }
                    if ($bn -ne $cand) { continue }
                    try {
                        $ip = $b.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
                        $ip.Invoke()
                        Write-Output (To-Json ([ordered]@{ ok = $true; typed = $Arg; button = $bn }))
                        exit 0
                    } catch { }
                }
            }
            Write-Output (To-Json ([ordered]@{ ok = $false; reason = "填了路径但找不到确认按钮"; typed = $Arg }))
            exit 0
        }
        Write-Output (To-Json ([ordered]@{ ok = $false; reason = "当前没有 #32770 原生对话框" }))
    }

    default {
        [Console]::Error.WriteLine("[uia] 未知 verb: $Verb")
        Write-Output "null"
    }
}
