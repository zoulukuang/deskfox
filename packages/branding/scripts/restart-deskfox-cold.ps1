# [fork-only] 冷启动测试一键脚本 — 杀 DeskFox + 等 sidecar 真死 + 重启
# [feat: startup-sidebar-ready-gate] 2026-05-29
#
# 用途:测试启动期 sidebar ready gate 视觉效果时,需要反复冷启动 DeskFox。
# 双击此 .ps1 或终端运行:
#   powershell -ExecutionPolicy Bypass -File D:\project\opencode-fork\packages\branding\scripts\restart-deskfox-cold.ps1
#
# 观察重点:启动后 1-3 秒内,左侧未选中项目图标会变灰(opacity 60%)+ 鼠标 hover 时变沙漏(cursor: wait)。
# 已选中的当前项目永远亮(toggle sidebar 不依赖 ready)。

$exe = "D:\project\opencode-fork\packages\desktop\src-tauri\target\release\DeskFox.exe"

Write-Host "[1/3] Kill DeskFox + opencode-cli 旧进程..." -ForegroundColor Yellow
Get-Process -Name DeskFox,opencode-cli -ErrorAction SilentlyContinue | Stop-Process -Force

# 等真的死透(避免 single-instance 检测到尸进程)
Start-Sleep -Milliseconds 800

Write-Host "[2/3] 启动 DeskFox.exe..." -ForegroundColor Cyan
Start-Process $exe

Write-Host "[3/3] 已启动。盯紧左侧项目图标:" -ForegroundColor Green
Write-Host "      - 启动期 1-3 秒:未选项目应**变灰** + 鼠标 hover **变沙漏**"
Write-Host "      - 启动完成:全部恢复正常 opacity / 光标"
Write-Host "      - 已选项目(当前项目):**永远亮**(点它能 toggle sidebar)"
Write-Host ""
Write-Host "测试:启动期点击 *未选* 项目 → 应无反应(被 gate 拦)"
Write-Host "     启动期点击 *已选* 项目 → 应正常 toggle sidebar"
