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

Write-Host "[media-gen-plugin] building media-gen dist (bun run build)..."
& bun run --cwd $MediaGenDir build
if ($LASTEXITCODE -ne 0) { Write-Error "[media-gen-plugin] media-gen build failed"; exit 1 }
if (-not (Test-Path $SrcDist)) { Write-Error "[media-gen-plugin] build reported success but no dist at $SrcDist"; exit 1 }

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }
Copy-Item $SrcDist $OutFile -Force

$OutSize = (Get-Item $OutFile).Length
Write-Host "[media-gen-plugin] staged: $([math]::Round($OutSize / 1024)) KB -> $OutFile"
