# [fork-only] DeskFox one-shot installer pipeline (NSIS)
#
# 发布渠道与版本号规则完整 doc:docs/governance/版本号与发布渠道规范.md
#   - Tier 1 稳定版(prod 无后缀,GitHub Release latest)
#   - Tier 2 预览版(dev `-dev` 后缀,GitHub Release prerelease)
#   - Tier 3 本地测试版(`build-deskfox.ps1 -Env dev -NoBundle` 出 raw exe,不 ship,不走本脚本)
#
# Workflow:
#   1. bump-installer-version.ps1    -> bump version (writes installer-versions.json + 版本日志.md placeholder)
#                                       — 可用 -SkipBump 跳过(CI 场景:user 本地已 bump 并 commit)
#   2. build-deskfox.ps1             -> tauri build 直接产出 NSIS .exe(Tauri updater 兼容格式)
#                                       — 可用 -SkipBuild 跳过(CI 已 build / 极快速重 pack 场景)
#   3. Print artifact path
#
# FORK: [启用自动升级] 2026-06-05 — 从 Inno Setup 切换到 Tauri NSIS installer
#   - 删除了 DeskFox.iss + ChineseSimplified.isl(Inno Setup 脚本)
#   - NSIS 由 Tauri bundler 直接产出(tauri.conf.json nsis 配置)
#   - 三档 AppId 通过 identifier 区分(ai.deskfox.app / ai.deskfox.app.beta / ai.deskfox.app.dev)
#   - 中英双语 + 桌面图标 + WebView2 bootstrapper 由 Tauri NSIS v2 自动处理
#   - 飞书/media-gen plugin 资源走 tauri.conf.json bundle.resources(macOS 已这么走,Win 对齐)
#
# Prereq:
#   - 默认会自动 build,不需要预跑 build-deskfox.ps1。仅 -SkipBuild 时 expects target/release/ 已就绪。
#   - Tauri CLI installed(bun run tauri --version)
#
# Usage:
#   & .\packages\branding\scripts\pack-installer.ps1                          # 默认 prod,bump + build + pack
#   & .\packages\branding\scripts\pack-installer.ps1 -Env beta
#   & .\packages\branding\scripts\pack-installer.ps1 -Env dev
#   & .\packages\branding\scripts\pack-installer.ps1 -Env prod -SkipBump      # 用现有 JSON 版本号 + rebuild + pack
#   & .\packages\branding\scripts\pack-installer.ps1 -Env prod -SkipBuild     # 用已 build 的 exe(谨慎 — 版本号可能 mismatch)
#   & .\packages\branding\scripts\pack-installer.ps1 -Env prod -SkipBump -SkipBuild  # CI:bump + build 都在外面做好

param(
    [ValidateSet("dev", "beta", "prod")]
    [string]$Env = "prod",
    [switch]$SkipBump,
    [switch]$SkipBuild,
    [string]$Version = "",
    # 版本号 bump 级别(透传 bump-installer-version.ps1):patch=小更新(默认) / minor=大版本(次 +1)
    [ValidateSet("patch", "minor")]
    [string]$Bump = "patch"
)

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$root = Split-Path -Parent $here
$repoRoot = Split-Path -Parent $root

# 1. determine version (bump 本地 / SkipBump 取已有)
if ($SkipBump) {
    if ($Version) {
        $newVersion = $Version
        Write-Output "[pack] -SkipBump -Version: using $newVersion (env=$Env)"
    } else {
        # FORK: 从 installer-versions.json 读(不再有 .iss AppVersion)[启用自动升级] 2026-06-05
        $versionsJson = Join-Path $root "installer-versions.json"
        $versions = Get-Content $versionsJson -Raw -Encoding UTF8 | ConvertFrom-Json
        $newVersion = $versions.windows
        if (-not $newVersion) { throw "[pack] -SkipBump 但 -Version 未传 且 installer-versions.json 里找不到 windows" }
        Write-Output "[pack] -SkipBump: read version from installer-versions.json = $newVersion (env=$Env)"
    }
} else {
    # FORK: bump 不再更新 .iss,只更新 installer-versions.json + installer-versions.md [启用自动升级] 2026-06-05
    $bumpOut = & (Join-Path $here "bump-installer-version.ps1") -Platform "Windows" -Env $Env -Bump $Bump
    $bumpOut | Write-Output
    $versionLine = $bumpOut | Where-Object { $_ -match '^VERSION=' } | Select-Object -First 1
    if (-not $versionLine) { throw "bump script did not produce VERSION= line" }
    $newVersion = $versionLine -replace '^VERSION=', ''
    Write-Output "[pack] bumped version: $newVersion (env=$Env)"
}

# 1.5 重 build DeskFox.exe 让 UI 版本号跟 bumped JSON 同步(2026-05-11 加)
# FORK: [启用自动升级] 2026-06-05 — build-deskfox.ps1 现在直接产出 NSIS .exe(不再需要单独 ISCC)
if ($SkipBuild) {
    Write-Output "[pack] -SkipBuild: 假设 target/release/ 已就绪,不重 build"
} else {
    Write-Output "[pack] build DeskFox(NSIS installer)..."
    & (Join-Path $here "build-deskfox.ps1") -Env $Env
    if ($LASTEXITCODE -ne 0) { throw "[pack] build-deskfox.ps1 failed with exit $LASTEXITCODE" }
}

# FORK: LO bundle 状态提示 — bundle 存在则打入 installer,缺失只提示不 block 2026-06-03
$loBundleSoffice = Join-Path $root "libreoffice-bundle\windows\program\soffice.exe"
if (Test-Path $loBundleSoffice) {
    $bundleSize = [math]::Round(
        (Get-ChildItem (Join-Path $root "libreoffice-bundle\windows") -Recurse -ErrorAction SilentlyContinue |
         Measure-Object -Property Length -Sum).Sum / 1MB)
    Write-Output "[pack] LibreOffice bundle ready ($bundleSize MB) — will be bundled into installer"
} else {
    Write-Output "[pack] LibreOffice bundle not prepared — installer will not contain bundled LO"
    Write-Output "[pack]   Users will need to download LO (~355MB) on first use of Office files"
    Write-Output "[pack]   To bundle: .\packages\branding\scripts\prepare-lo-bundle.ps1"
}

# 2. locate NSIS installer produced by tauri build
# FORK: [启用自动升级] 2026-06-05 — NSIS .exe 由 Tauri bundler 产出,不再走 ISCC
# Tauri NSIS output: target/release/bundle/nsis/<ProductName>_<Version>_x64-setup.exe
$envSuffix = switch ($Env) {
    "prod" { "" }
    "beta" { " Beta" }
    "dev"  { " Dev" }
}
$productName = "DeskFox$envSuffix"
$numericVersion = $newVersion -replace '-(dev|beta)$', ''
$nsisDir = Join-Path $repoRoot "packages\desktop\src-tauri\target\release\bundle\nsis"

if (-not (Test-Path $nsisDir)) {
    throw "NSIS output directory not found: $nsisDir — tauri build may have failed or used -NoBundle"
}

# Tauri NSIS naming: <ProductName>_x64-setup.exe (version embedded in installer metadata)
$nsisFiles = Get-ChildItem $nsisDir -Filter "*.exe" | Sort-Object LastWriteTime -Descending
if ($nsisFiles.Count -eq 0) {
    throw "No .exe found in $nsisDir"
}
$installerPath = $nsisFiles[0].FullName
$size = $nsisFiles[0].Length
Write-Output ""
Write-Output "[pack] installer ready:"
Write-Output "  $installerPath"
Write-Output "  size: $size bytes"
Write-Output "  version: $numericVersion (env=$Env)"
Write-Output ""
Write-Output "[pack] remember to fill the placeholder in docs/installer-versions.md with summary after testing"