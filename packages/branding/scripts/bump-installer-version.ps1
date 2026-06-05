# [fork-only] DeskFox installer version bump (semver YYYY.次.补)
#
# 版本号规则(2026-06-05 起,详 docs/governance/版本号与发布渠道规范.md §三):
#   格式 YYYY.MINOR.PATCH(3 段合法 semver;旧 YYYY.M.D.N 日历号已废)
#     YYYY  = 年份(跨年自动进位,reset 到 <年>.1.0)
#     MINOR = 功能波次,大更新 +1(-Bump minor),进位时 PATCH 归零
#     PATCH = 修补号,小更新 +1(-Bump patch,默认)
#   起步 2026.6.0。例:小更 2026.6.0->2026.6.1;大更 2026.6.0->2026.7.0;跨年 ->2027.1.0
#
# 各端独立计数:installer-versions.json 里 windows/macos/linux 各一条独立版本线。
#   env(prod/dev/beta)【不进版本号】,只体现在文件名/渠道(见规范 §3.5);故本脚本不按 env 分计数。
#
# Side effects:
#   1. 更新 packages/branding/installer-versions.json 对应平台 key(前端读它渲染设置页版本牌)
#   2. 在 docs/installer-versions.md 顶部 prepend 占位条目(ship 后回填)
#
# 注入到 Tauri app version:见 build-deskfox.ps1/.sh(build 前 patch on-disk tauri.conf.json,
#   修历史 exe=0.0.0)。本脚本只动 installer-versions.json + 台账,不碰 tauri.conf。
#
# Output: 末行 "VERSION=<新版本>"(pack-installer.ps1 解析用)

param(
    [ValidateSet("Windows", "macOS", "Linux")]
    [string]$Platform = "Windows",
    # FORK: [启用自动升级] 2026-06-05 — Env 不再进版本号(各端版本号 env 无关),保留参数仅为兼容旧调用
    [ValidateSet("dev", "beta", "prod")]
    [string]$Env = "prod",
    # 大更新进 minor(次),小更新进 patch(补,默认)
    [ValidateSet("patch", "minor")]
    [string]$Bump = "patch",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$repoRoot = Split-Path -Parent $root
$logFile = Join-Path $repoRoot "docs/installer-versions.md"
$jsonFile = Join-Path $root "branding/installer-versions.json"

if (-not (Test-Path $logFile)) { throw "version log not found: $logFile" }
if (-not (Test-Path $jsonFile)) { throw "installer-versions.json not found: $jsonFile" }

$jsonKey = switch ($Platform) { "Windows" { "windows" } "macOS" { "macos" } "Linux" { "linux" } }

# 读当前版本(per-platform 独立)
$versions = Get-Content $jsonFile -Raw -Encoding UTF8 | ConvertFrom-Json
$current = [string]$versions.$jsonKey
if (-not $current) { throw "installer-versions.json missing platform key '$jsonKey'" }
if ($current -notmatch '^(\d{4})\.(\d+)\.(\d+)$') {
    # 当前版本必须 3 段 semver(YYYY.次.补);旧 4 段日历号已废,详见版本号规范 §三
    throw "version '$current' is not 3-part semver (YYYY.MINOR.PATCH). Old 4-part calendar scheme retired; set semver (e.g. 2026.6.0) in installer-versions.json. See governance doc."
}
$curYear = [int]$Matches[1]; $curMinor = [int]$Matches[2]; $curPatch = [int]$Matches[3]
$thisYear = [int](Get-Date -Format "yyyy")

# 计算新版本
if ($thisYear -gt $curYear) {
    # 跨年 → 新年度第一波
    $newVersion = "$thisYear.1.0"
    $how = "year-rollover ($curYear->$thisYear)"
} elseif ($Bump -eq "minor") {
    # 大更新:次 +1,补归零
    $newVersion = "$curYear.$($curMinor + 1).0"
    $how = "minor (feature wave, MINOR+1)"
} else {
    # 小更新:补 +1
    $newVersion = "$curYear.$curMinor.$($curPatch + 1)"
    $how = "patch (fix, PATCH+1)"
}

Write-Output "[bump] platform=$Platform, $current -> $newVersion [$how]"

if ($DryRun) {
    Write-Output "[bump] DRY RUN, no files changed."
    Write-Output "VERSION=$newVersion"
    exit 0
}

# 1. Prepend 占位条目到台账(在首个 ## entry 之前)
$logContent = Get-Content $logFile -Raw -Encoding UTF8
$placeholder = @"

## [$Platform] $newVersion - $(Get-Date -Format "yyyy-MM-dd HH:mm")

(待填: ship 后回填本条 — 包含 commits / 配套 plugin / installer 路径等)

---
"@
$firstHeaderIdx = $logContent.IndexOf("`n## ")
if ($firstHeaderIdx -lt 0) {
    Add-Content -Path $logFile -Value $placeholder -Encoding UTF8
} else {
    $before = $logContent.Substring(0, $firstHeaderIdx)
    $after  = $logContent.Substring($firstHeaderIdx)
    $merged = $before + $placeholder + "`n" + $after
    Set-Content -Path $logFile -Value $merged -Encoding UTF8 -NoNewline
}
Write-Output "[bump] prepended placeholder to $logFile"

# 2. 更新 installer-versions.json 对应平台 key(surgical regex,保留格式/缩进/key 顺序)
$jsonContent = Get-Content $jsonFile -Raw -Encoding UTF8
$pattern = "(`"$jsonKey`"\s*:\s*`")[^`"]*(`")"
$replaced = [regex]::Replace($jsonContent, $pattern, "`${1}$newVersion`${2}")
if ($replaced -eq $jsonContent) {
    throw "installer-versions.json: key '$jsonKey' not found, file may be malformed: $jsonFile"
}
Set-Content -Path $jsonFile -Value $replaced -Encoding UTF8 -NoNewline
Write-Output "[bump] updated $jsonFile -> $jsonKey=$newVersion"

# 3. 输出新版本(caller 解析)
Write-Output "VERSION=$newVersion"
