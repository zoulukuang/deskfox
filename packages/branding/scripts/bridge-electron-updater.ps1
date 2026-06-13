# FORK: 跨引擎升级桥 — 让老 Tauri 用户经其更新器自动升级到新 Electron 版
#   [feat: tauri-to-electron-upgrade-bridge] 2026-06-13
#
# 背景:老 Tauri 版更新器查 updates.deskfox.ai/v1/latest/desktop/<target>/latest.json(Tauri minisign 格式);
#   新 Electron 版用 electron-updater 查 .../electron/<channel>/latest.yml。两条链互不相见 → 老用户收不到 Electron 版。
# 本脚本产「摆渡 manifest」:用 Tauri minisign 私钥给 Electron NSIS 安装包签名,生成 Tauri 格式 latest.json
#   指向该 Electron 安装包 → 部署到老端点后,老 Tauri 更新器下载 + 验签通过 + 运行 → 装上 Electron 版。
#   (Electron NSIS 同时静默卸旧 Tauri,见 electron-builder.deskfox.config.ts 的 nsis.include。)
#
# 用法:
#   ./bridge-electron-updater.ps1 -Exe <electron-nsis-setup.exe> -Version <YYYY.M.D> -Url <CDN下载URL> -Env <prod|beta|dev> -Out <输出目录>
# 产出:<Out>/<exe>.sig(Tauri minisign 签名)+ <Out>/latest.json(摆渡 manifest)
# 部署:把 latest.json 放到 updates.deskfox.ai/v1/latest/desktop[-<env>]/windows/latest.json(同 /ship 步骤 7.5 通道)。

param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$Url,
  [string]$Env = "prod",
  [string]$Out = "$env:TEMP\deskfox-bridge"
)
$ErrorActionPreference = "Stop"
$repoRoot = Split-Path (Split-Path (Split-Path $PSScriptRoot))  # packages/branding/scripts → repo root

if (-not (Test-Path $Exe)) { throw "Electron 安装包不存在: $Exe" }

# 1) 载入 Tauri minisign 私钥(与 Tauri ship 同源:~/.deskfox-signing/config.env)
$configEnv = Join-Path $HOME ".deskfox-signing\config.env"
if (Test-Path $configEnv) {
  $content = [System.IO.File]::ReadAllText($configEnv)
  $keyMatch = [regex]::Match($content, "TAURI_SIGNING_PRIVATE_KEY\s*=\s*([^\r\n]+)")
  if ($keyMatch.Success) { $env:TAURI_SIGNING_PRIVATE_KEY = $keyMatch.Groups[1].Value.Trim() }
  $pwMatch = [regex]::Match($content, "TAURI_SIGNING_PRIVATE_KEY_PASSWORD\s*=\s*([^\r\n]*)")
  if ($pwMatch.Success) { $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $pwMatch.Groups[1].Value.Trim() }
}
if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
  throw "缺 TAURI_SIGNING_PRIVATE_KEY(查 ~/.deskfox-signing/config.env)— 无私钥老 Tauri 更新器验签必失败"
}

New-Item -ItemType Directory -Force -Path $Out | Out-Null
$exeName = Split-Path $Exe -Leaf
$exeCopy = Join-Path $Out $exeName
Copy-Item $Exe $exeCopy -Force

# 2) tauri signer 用 Tauri 私钥给 Electron NSIS 签名 → <exe>.sig
#    tauri CLI 在 Tauri 主仓(本 Electron worktree 无 Tauri 依赖)。按序找:worktree → 兄弟主仓 opencode-fork → PATH。
$tauriCandidates = @(
  (Join-Path $repoRoot "packages\desktop\node_modules\.bin\tauri.exe"),
  (Join-Path (Split-Path $repoRoot) "opencode-fork\packages\desktop\node_modules\.bin\tauri.exe")
)
$tauriCli = $tauriCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $tauriCli) { $tauriCli = "tauri" }
& $tauriCli signer sign -k $env:TAURI_SIGNING_PRIVATE_KEY -p $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD $exeCopy
$sigPath = "$exeCopy.sig"
if (-not (Test-Path $sigPath)) { throw "签名失败:未产出 $sigPath" }
Write-Output "[bridge] signed: $sigPath"

# 3) 生成 Tauri 格式摆渡 latest.json(复用 finalize-latest-json.ts)
$finalize = Join-Path $repoRoot "packages\branding\scripts\finalize-latest-json.ts"
$manifestOut = Join-Path $Out "manifest"
& bun run $finalize --target windows --version $Version --url $Url --sig $sigPath --pub-date "$(Get-Date -Format yyyy-MM-ddTHH:mm:ssZ)" --out $manifestOut
$latest = Join-Path $manifestOut "latest.json"
if (-not (Test-Path $latest)) { throw "finalize 未产出 latest.json" }

Write-Output "[bridge] DONE"
Write-Output "  signature: $sigPath"
Write-Output "  manifest : $latest"
Write-Output "  部署到老端点: updates.deskfox.ai/v1/latest/desktop$(if($Env -ne 'prod'){"-$Env"})/windows/latest.json"
Write-Output "  老 Tauri 用户下次查更新即下载该 Electron 安装包并验签升级。"
