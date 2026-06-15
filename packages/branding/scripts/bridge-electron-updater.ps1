# FORK: 跨引擎升级桥 — 让老 Tauri 用户经其更新器自动升级到新 Electron 版
#   [feat: tauri-to-electron-upgrade-bridge] 2026-06-13
#
# 背景:老 Tauri 版更新器查 updates.deskfox.ai/v1/latest/desktop/<target>/latest.json(Tauri minisign 格式);
#   新 Electron 版用 electron-updater 查 .../electron/<channel>/latest.yml。两条链互不相见 → 老用户收不到 Electron 版。
# 本脚本产「摆渡 manifest」:用 Tauri minisign 私钥给 Electron NSIS 安装包签名,生成 Tauri 格式 latest.json
#   指向该 Electron 安装包 → 部署到老端点后,老 Tauri 更新器下载 + 验签通过 + 运行 → 装上 Electron 版。
#   (Electron NSIS 同时静默卸旧 Tauri,见 electron-builder.deskfox.config.ts 的 nsis.include。)
#
# 🔴 切换日必看 — 版本号坑(2026-06-13 运行时验证挖到):
#   摆渡 manifest 的 -Version **必须 > 已装老 Tauri 版的版本号**,否则 Tauri 更新器判"无更新/降级"不推送。
#   老 Tauri DeskFox 用**日历版本号** `YYYY.M.D`(如 2026.7.1);新 Electron 实际版本是上游 semver `1.17.x`
#   —— `1.17.4 < 2026.x`!所以这里**绝不能填 Electron 的真实版本 1.17.x**,要填一个 **> 最高已发 Tauri 版**
#   的值(沿用日历号即可,如 `2026.12.1` 或更高;脚本会拦截明显的 semver 误填)。
#   (这只影响 Tauri 更新器的版本比较;装上后 Electron 自己的 electron-updater 用它自己的 1.17.x 版本线,互不干扰。)
#
# 用法:
#   ./bridge-electron-updater.ps1 -Exe <electron-nsis-setup.exe> -Version <必须>老Tauri日历版,如 2026.12.1> -Url <CDN下载URL> -Env <prod|beta|dev> -Out <输出目录>
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

# 🔴 版本号防呆:老 Tauri 用日历版 YYYY.M.D,首段是年份(>=2026)。若首段 < 2000 几乎肯定是误填了
#   Electron 的 semver(如 1.17.4)→ 老 Tauri 会判降级不推送。拦下,逼用户填 > 老 Tauri 版的日历号。
$firstSeg = ($Version -split '[.\-]')[0] -as [int]
if ($null -eq $firstSeg -or $firstSeg -lt 2000) {
  throw "版本号 '$Version' 看起来是 Electron semver,但老 Tauri 用日历版 YYYY.M.D,会把它判成降级不推送。" +
        "请填一个 > 最高已发 Tauri 版的日历号(如 2026.12.1)。详见脚本头部「版本号坑」。"
}

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
