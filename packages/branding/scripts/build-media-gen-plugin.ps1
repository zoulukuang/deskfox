# [fork-only] 打包 media-gen plugin 进 installer 用(Win 版,对称 build-media-gen-plugin.sh)
# [feat: media-gen-bundle] 2026-05-27
# 复用 packages/media-gen/build.ts(已验证产物)出 dist/plugin.js,拷进 branding/plugin/media-gen/。
# Tauri 把这个目录作为 resource ship 进 .exe installer(tauri.conf.json resources)。
# 装完 lib.rs setup hook 把 path 注入 user opencode 配置(同 feishu-bridge)。
#
# 用法: powershell -File packages/branding/scripts/build-media-gen-plugin.ps1

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BrandingRoot = Split-Path -Parent $ScriptDir
$RepoRoot = Split-Path -Parent (Split-Path -Parent $BrandingRoot)

$MediaGenDir = Join-Path $RepoRoot "packages\media-gen"
$SrcDist = Join-Path $MediaGenDir "dist\plugin.js"
$OutDir = Join-Path $BrandingRoot "plugin\media-gen\dist"
$OutFile = Join-Path $OutDir "plugin.js"

if (-not (Test-Path (Join-Path $MediaGenDir "build.ts"))) {
    Write-Error "[media-gen-plugin] build.ts not found in $MediaGenDir"
    exit 1
}

# FORK: 对齐 build-feishu-plugin.ps1 —— 补时间戳跳过(原 .ps1 漏了,与 feishu 不对称:每次都重建)+ 用
# `bun run --silent` 避免 PS5.1 把 bun 的 "$ ..." banner stderr 误包成 NativeCommandError 中断整个打包。
# 比较 media-gen src/*.ts + build.ts + package.json 与最终 branding 副本 $OutFile 的 mtime,无源码变更秒跳过。
# FORK: 加固(code-review) —— ① 纳入 package.json(依赖/构建配置变更也应触发重建,避免打包旧 dist);
# ② -le → -lt:mtime 相等(同秒编辑)也重建,不漏改。[feat: stale-path-hardening] 2026-06-26
$MediaSrc = Join-Path $MediaGenDir "src"
$NeedRebuild = $true
if (Test-Path $OutFile) {
    $OutMtime = (Get-Item $OutFile).LastWriteTime
    $latestList = @()
    if (Test-Path $MediaSrc) {
        $latestList += Get-ChildItem -Recurse -File -Path $MediaSrc -Include "*.ts" -ErrorAction SilentlyContinue
    }
    $latestList += Get-Item (Join-Path $MediaGenDir "build.ts")
    $MediaPkg = Join-Path $MediaGenDir "package.json"
    if (Test-Path $MediaPkg) { $latestList += Get-Item $MediaPkg }
    $LatestSrc = $latestList | Measure-Object -Property LastWriteTime -Maximum
    if ($LatestSrc.Maximum -and $LatestSrc.Maximum -lt $OutMtime) {
        $NeedRebuild = $false
    }
}

if (-not $NeedRebuild) {
    Write-Host "[media-gen-plugin] up-to-date: $OutFile"
    exit 0
}

Write-Host "[media-gen-plugin] building media-gen dist (bun run build)..."
& bun run --silent --cwd $MediaGenDir build
if ($LASTEXITCODE -ne 0) { Write-Error "[media-gen-plugin] media-gen build failed"; exit 1 }
if (-not (Test-Path $SrcDist)) { Write-Error "[media-gen-plugin] build reported success but no dist at $SrcDist"; exit 1 }

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }
Copy-Item $SrcDist $OutFile -Force

$OutSize = (Get-Item $OutFile).Length
Write-Host "[media-gen-plugin] staged: $([math]::Round($OutSize / 1024)) KB -> $OutFile"
