# [fork-only] prepare-lo-bundle.ps1 — LibreOffice bundle 准备脚本
#
# 一次性开发工具:下载 LibreOffice MSI → msiexec /a 提取 → 剥皮(去除 headless PDF 转换不需要的
# 组件)→ 写入 packages/branding/libreoffice-bundle/windows/
#
# 输出目录不进 git(.gitignore 已忽略)。pack-installer.ps1 / DeskFox.iss 会自动检测并打入 installer。
#
# 前置要求:
#   - Windows (x64)
#   - 需要管理员权限(msiexec /a 需要 elevated)
#   - 互联网连接(从国内镜像下载,约 355MB)
#
# 用法:
#   # 在 repo 根目录运行 (管理员 PowerShell):
#   & .\packages\branding\scripts\prepare-lo-bundle.ps1
#   & .\packages\branding\scripts\prepare-lo-bundle.ps1 -Version "26.2.2"
#   & .\packages\branding\scripts\prepare-lo-bundle.ps1 -Force   # 强制重下载

param(
    [string]$Version  = "26.2.2",
    [switch]$Force              # 强制重下载(即使 MSI cache 已存在)
)

$ErrorActionPreference = "Stop"

$here        = $PSScriptRoot
$brandingDir = Split-Path -Parent $here                         # packages/branding/
$outputDir   = Join-Path $brandingDir "libreoffice-bundle\windows"
$cacheDir    = Join-Path $env:TEMP "deskfox-lo-cache"
$extractBase = Join-Path $env:TEMP "deskfox-lo-extract-$Version"
$msiName     = "LibreOffice_${Version}_Win_x86-64.msi"
$msiPath     = Join-Path $cacheDir $msiName

# 检查管理员权限 — msiexec /a 需要 elevation
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Warning "⚠  当前非管理员。msiexec /a 需要管理员权限。"
    Write-Warning "   请右键 PowerShell → '以管理员身份运行',然后重新执行本脚本。"
    throw "需要管理员权限"
}

# 镜像列表(与 office-installer.ts 同步)
$mirrors = @(
    "https://mirrors.tuna.tsinghua.edu.cn/libreoffice/libreoffice/stable",
    "https://mirrors.ustc.edu.cn/tdf/libreoffice/stable",
    "https://mirrors.bfsu.edu.cn/libreoffice/libreoffice/stable",
    "https://mirrors.nju.edu.cn/tdf/libreoffice/stable",
    "https://download.documentfoundation.org/libreoffice/stable"
)

# ── Step 1: 下载 MSI ──────────────────────────────────────────────────────────
$existingSize = if (Test-Path $msiPath) { (Get-Item $msiPath).Length } else { 0 }
$reuse = (-not $Force) -and ($existingSize -gt 100MB)

if ($reuse) {
    Write-Host "[1/4] 复用已缓存 MSI ($([math]::Round($existingSize/1MB)) MB): $msiPath"
} else {
    New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
    $downloaded = $false
    foreach ($mirror in $mirrors) {
        $url = "$mirror/$Version/win/x86_64/$msiName"
        Write-Host "[1/4] 从 $mirror 下载 $msiName ..."
        try {
            $partPath = "$msiPath.part"
            Remove-Item $partPath -ErrorAction SilentlyContinue
            # 使用 BITS 加速(断点续传,比 Invoke-WebRequest 稳定)
            try {
                Import-Module BitsTransfer -ErrorAction Stop
                Start-BitsTransfer -Source $url -Destination $partPath -DisplayName "DeskFox LO Bundle" -ErrorAction Stop
            } catch {
                # BITS 不可用时 fallback 到 Invoke-WebRequest
                Invoke-WebRequest -Uri $url -OutFile $partPath -UseBasicParsing
            }
            if (-not (Test-Path $partPath)) { throw "下载后文件不存在" }
            $dlSize = (Get-Item $partPath).Length
            if ($dlSize -lt 100MB) { throw "下载文件过小 ($dlSize bytes),可能不完整" }
            Move-Item $partPath $msiPath -Force
            $downloaded = $true
            Write-Host "    ✓ 下载成功 ($([math]::Round($dlSize/1MB)) MB)"
            break
        } catch {
            Write-Host "    ✗ 镜像失败: $_"
            Remove-Item "$msiPath.part" -ErrorAction SilentlyContinue
        }
    }
    if (-not $downloaded) { throw "所有镜像均下载失败。请检查网络或手动下载 MSI 到: $msiPath" }
}

# ── Step 2: msiexec /a 解压 ───────────────────────────────────────────────────
Write-Host "[2/4] 解压 MSI(msiexec /a) → $extractBase ..."
Remove-Item $extractBase -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $extractBase -Force | Out-Null

$proc = Start-Process -FilePath "msiexec.exe" `
    -ArgumentList "/a `"$msiPath`" /qn TARGETDIR=`"$extractBase`"" `
    -Wait -PassThru -WindowStyle Hidden
if ($proc.ExitCode -ne 0) {
    throw "msiexec /a 失败,退出码: $($proc.ExitCode)。可能需要管理员权限或 MSI 损坏。"
}

# 找 soffice.exe 确定 LO base dir
$sofficeExe = Get-ChildItem -Path $extractBase -Filter "soffice.exe" -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notlike "*\UninstallHelper*" } |
    Select-Object -First 1
if (-not $sofficeExe) { throw "解压目录中找不到 soffice.exe: $extractBase" }

$loProgramDir = $sofficeExe.DirectoryName
$loBaseDir    = Split-Path $loProgramDir -Parent
Write-Host "    LO base: $loBaseDir"

# ── Step 3: 剥皮 ─────────────────────────────────────────────────────────────
Write-Host "[3/4] 剥皮(删除 headless PDF 转换不需要的组件)..."
$stripFolders = @(
    "help",                  # 帮助文档
    "share\gallery",         # 剪贴画库
    "share\template",        # 文档模板
    "share\autotext",        # 自动文本
    "share\autocorrect",     # 自动更正
    "share\wordbook",        # 拼写词典(可能最大,>100MB)
    "share\basic",           # Basic IDE(不需要 headless 宏)
    "share\xslt",            # XSLT 转换(非二进制格式互转不需要)
    "presets",               # UI 预设配置
    "readmes"                # 说明文档
)

$totalStripped = 0L
foreach ($folder in $stripFolders) {
    $target = Join-Path $loBaseDir $folder
    if (Test-Path $target) {
        $folderSize = (Get-ChildItem $target -Recurse -ErrorAction SilentlyContinue |
            Measure-Object -Property Length -Sum).Sum
        if (-not $folderSize) { $folderSize = 0 }
        $totalStripped += $folderSize
        Write-Host ("    剥 {0,-30} {1,6:N0} MB" -f $folder, ($folderSize / 1MB))
        Remove-Item $target -Recurse -Force
    }
}
Write-Host ("    共剥皮: {0:N0} MB" -f ($totalStripped / 1MB))

# ── Step 4: 复制到 bundle 输出目录 ───────────────────────────────────────────
Write-Host "[4/4] 复制到 $outputDir ..."
if (Test-Path $outputDir) { Remove-Item $outputDir -Recurse -Force }
New-Item -ItemType Directory -Path (Split-Path $outputDir -Parent) -Force | Out-Null
Copy-Item $loBaseDir $outputDir -Recurse -Force

# 清理解压临时目录(保留 MSI cache 供下次复用)
Remove-Item $extractBase -Recurse -Force -ErrorAction SilentlyContinue

# 报告
$finalSize = (Get-ChildItem $outputDir -Recurse -ErrorAction SilentlyContinue |
    Measure-Object -Property Length -Sum).Sum
if (-not $finalSize) { $finalSize = 0 }

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
Write-Host "✓ bundle 准备完成"
Write-Host "  路径: $outputDir"
Write-Host "  大小: $([math]::Round($finalSize/1MB)) MB (未压缩,LZMA2 压缩后约减半)"
Write-Host ""
Write-Host "下一步: 运行 pack-installer.ps1 将自动打入 installer"
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
