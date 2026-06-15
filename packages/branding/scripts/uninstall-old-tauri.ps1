# FORK: 切换日清理 — 静默卸载老 Tauri 版 DeskFox(跨引擎迁移,避免与新 Electron 版双装)
#   [feat: tauri-to-electron-upgrade-bridge] 2026-06-13
#
# 老 Tauri NSIS 安装器把卸载信息登记在 HKCU\...\Uninstall\{渠道GUID}。本脚本按渠道读 UninstallString
# 并以 /S 静默卸载。**默认 dry-run 只报告**,加 -Execute 才真卸。卸载不删 AppData(老 Tauri NSIS
# 默认保留 Roaming\<id>;关键数据走 xdg 由新版自动继承,.dat 偏好即便丢也只影响窗口位置)。
#
# 用法:
#   ./uninstall-old-tauri.ps1 -Env dev            # dry-run:只检测并报告
#   ./uninstall-old-tauri.ps1 -Env prod -Execute  # 真卸载同渠道老 Tauri prod

param(
  [ValidateSet("dev", "beta", "prod")][string]$Env = "prod",
  [switch]$Execute
)
$ErrorActionPreference = "Stop"

# 老 Tauri Win AppId 三档 GUID(docs/governance/应用身份-命名规则.md,2026-04-30 锁死)
$GUIDS = @{
  prod = "{F9F6F6C5-D865-468C-BCE5-BF0ECA24A763}"
  beta = "{86413DCA-EA81-415A-A309-473EBFD78990}"
  dev  = "{4C5D29F2-3BBB-49A2-B248-B74B716F8EA1}"
}
$guid = $GUIDS[$Env]

# Tauri NSIS(currentUser 模式)登记在 HKCU;兼容也查 HKLM(perMachine 旧装)
$keys = @(
  "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$guid",
  "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$guid",
  "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\$guid"
)

$found = $null
foreach ($k in $keys) {
  if (Test-Path $k) {
    $p = Get-ItemProperty $k -ErrorAction SilentlyContinue
    if ($p.UninstallString) { $found = @{ Key = $k; UninstallString = $p.UninstallString; Version = $p.DisplayVersion }; break }
  }
}

if (-not $found) {
  Write-Output "[uninstall-old-tauri] 未检测到老 Tauri DeskFox ($Env, GUID $guid) — 无需清理。"
  exit 0
}

Write-Output "[uninstall-old-tauri] 检测到老 Tauri DeskFox ($Env):"
Write-Output "  注册表: $($found.Key)"
Write-Output "  版本  : $($found.Version)"
Write-Output "  卸载器: $($found.UninstallString)"

if (-not $Execute) {
  Write-Output "[dry-run] 未执行卸载。加 -Execute 真卸载(/S 静默,保留 AppData)。"
  exit 0
}

# 真卸载:Tauri NSIS 卸载器吃 /S 静默
$exe = $found.UninstallString.Trim('"')
Write-Output "[uninstall-old-tauri] 执行静默卸载..."
Start-Process -FilePath $exe -ArgumentList "/S" -Wait
Write-Output "[uninstall-old-tauri] 老 Tauri DeskFox ($Env) 已卸载(AppData 保留供新版继承)。"
