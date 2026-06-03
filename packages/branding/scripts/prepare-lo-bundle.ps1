# [fork-only] prepare-lo-bundle.ps1 — LibreOffice bundle 准备脚本
#
# 一次性开发工具:下载 LibreOffice MSI -> msiexec /a 提取 -> 剥皮(去除 headless PDF 转换不需要的
# 组件)-> 写入 packages/branding/libreoffice-bundle/windows/
#
# 输出目录不进 git(.gitignore 已忽略)。pack-installer.ps1 / DeskFox.iss 会自动检测并打入 installer。
#
# 注意:本文件必须以 UTF-8 with BOM 保存,否则 Windows PowerShell 5.1 按 GBK 解码会令中文乱码、
#       解析失败。用 Write 工具改完后须用 .NET WriteAllText + UTF8Encoding($true) 重新加 BOM。
#
# 前置要求:
#   - Windows (x64)
#   - 互联网连接(从国内镜像下载,约 350MB)
#   - msiexec /a 提取通常不需管理员权限(只解包不写系统),若失败再用管理员 PowerShell 重跑
#
# 用法:
#   & .\packages\branding\scripts\prepare-lo-bundle.ps1
#   & .\packages\branding\scripts\prepare-lo-bundle.ps1 -Version "25.8.7"
#   & .\packages\branding\scripts\prepare-lo-bundle.ps1 -Force   # 强制重下载

param(
    [string]$Version  = "25.8.7",   # 默认走 LibreOffice Still(稳定线)最新,求稳优先(2026-06-03 user 拍板)
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

# 管理员权限:msiexec /a(administrative install)只是把 MSI 解包到目录,不写注册表/不装系统,
# 通常不需要提权。这里只 warn 不 throw,让 /a 自己尝试;若真失败,后面 exit code 检查会报错,
# 届时用管理员 PowerShell 重跑即可。(2026-06-03 放宽,原硬 throw 过度保守)
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Warning "[!] 当前非管理员。msiexec /a 提取通常不需提权,继续尝试..."
    Write-Warning "    若 [2/4] 提取步骤失败,请用管理员 PowerShell 重跑本脚本。"
}

# 镜像列表(与 office-installer.ts 同步)
$mirrors = @(
    "https://mirrors.tuna.tsinghua.edu.cn/libreoffice/libreoffice/stable",
    "https://mirrors.ustc.edu.cn/tdf/libreoffice/stable",
    "https://mirrors.bfsu.edu.cn/libreoffice/libreoffice/stable",
    "https://mirrors.nju.edu.cn/tdf/libreoffice/stable",
    "https://download.documentfoundation.org/libreoffice/stable"
)

# -- Step 1: 下载 MSI ----------------------------------------------------------
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
            Write-Host "    [OK] 下载成功 ($([math]::Round($dlSize/1MB)) MB)"
            break
        } catch {
            Write-Host "    [X] 镜像失败: $_"
            Remove-Item "$msiPath.part" -ErrorAction SilentlyContinue
        }
    }
    if (-not $downloaded) { throw "所有镜像均下载失败。请检查网络或手动下载 MSI 到: $msiPath" }
}

# -- Step 2: msiexec /a 解压 ---------------------------------------------------
Write-Host "[2/4] 解压 MSI(msiexec /a) -> $extractBase ..."
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

# -- Step 3: 剥皮 --------------------------------------------------------------
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
    "readmes",               # 说明文档
    "share\wizards"          # 文档向导(headless 不需要)
)
# 注意: share\extensions 不在此列表 —— 整个删除目录会导致 soffice 首次创建 user profile
# 失败(Fatal Error: User installation could not be completed)。改为下方"删内容留骨架"。

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
Write-Host ("    共剥皮(整目录): {0:N0} MB" -f ($totalStripped / 1MB))

# 精细剥皮(2026-06-03 体积优化第二轮)
# extensions: 删子目录内容(拼写词典 ~460MB)但保留 extensions 目录骨架。
# 整个删除目录会导致 soffice 首次创建 user profile 失败(实测 2026-06-03:
# Fatal Error - User installation could not be completed)。
$extDir = Join-Path $loBaseDir "share\extensions"
if (Test-Path $extDir) {
    $extBefore = (Get-ChildItem $extDir -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
    Get-ChildItem $extDir -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host ("    剥 share\extensions 内容(留骨架)     {0,6:N0} MB" -f ($extBefore / 1MB))
}
# resource: 只留 common,删所有语言 UI 翻译(headless 转 PDF 不显示界面,英文是内置源语言,约 -260MB)
$resourceDir = Join-Path $loBaseDir "program\resource"
if (Test-Path $resourceDir) {
    $resBefore = (Get-ChildItem $resourceDir -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
    Get-ChildItem $resourceDir -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne 'common' } |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    $resAfter = (Get-ChildItem $resourceDir -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
    Write-Host ("    剥 program\resource 非 common 语言   {0,6:N0} MB" -f (($resBefore - $resAfter) / 1MB))
}
# config: 删 UI 图标主题 zip(headless 不渲染工具栏图标,约 -40MB)
$cfgImages = Get-ChildItem (Join-Path $loBaseDir "share\config") -Filter "images_*.zip" -ErrorAction SilentlyContinue
if ($cfgImages) {
    $imgSz = ($cfgImages | Measure-Object Length -Sum).Sum
    $cfgImages | Remove-Item -Force -ErrorAction SilentlyContinue
    Write-Host ("    剥 share\config UI 图标主题          {0,6:N0} MB" -f ($imgSz / 1MB))
}
# administrative install 在提取根留的 MSI 副本 + 顶层多余文件(约 -19MB)
Get-ChildItem $loBaseDir -Filter "*.msi" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

# -- Step 4: 复制到 bundle 输出目录 --------------------------------------------
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
Write-Host "=============================================="
Write-Host "[OK] bundle 准备完成"
Write-Host "  版本: LibreOffice $Version"
Write-Host "  路径: $outputDir"
Write-Host "  大小: $([math]::Round($finalSize/1MB)) MB (未压缩,LZMA2 压缩后约减半)"
Write-Host ""
Write-Host "下一步: 运行 pack-installer.ps1 将自动打入 installer"
Write-Host "=============================================="
