# [fork-only] prepare-lo-bundle.ps1 — LibreOffice bundle 准备脚本
#
# 一次性开发工具:下载 LibreOffice MSI -> msiexec /a 提取 -> 剥皮(去除 headless PDF 转换不需要的
# 组件)-> 写入 packages/branding/libreoffice-bundle/windows/
#
# 输出目录不进 git(.gitignore 已忽略)。build-deskfox-electron.ps1 会自动检测并打入 NSIS installer。
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

# 校验 MSI 文件头(复合文档 magic D0CF11E0A1B11AE1),防 CDN/代理截断的 HTML 错误页或半截文件
# 通过 size>100MB 检查却不是有效 MSI(2026-06-03 code-review #9)。只读前 8 字节,不整文件载入。
$fsCheck = [System.IO.File]::OpenRead($msiPath)
try {
    $head = New-Object byte[] 8
    $null = $fsCheck.Read($head, 0, 8)
} finally { $fsCheck.Close() }
$msiMagic = @(0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1)
if (@(Compare-Object $head $msiMagic -SyncWindow 0).Count -ne 0) {
    throw "MSI 文件头校验失败 — 非有效 MSI(可能下载被截断/返回错误页): $msiPath。删除后重跑(加 -Force)。"
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
# 只认 program\soffice.exe(真正的 LO 主程序),排除 UninstallHelper 及未来可能新增的其它
# soffice.exe 变体 — 否则 -First 1 选错会让 loBaseDir 推导错位、剥皮全静默失效(2026-06-03 code-review #6)
$sofficeExe = Get-ChildItem -Path $extractBase -Filter "soffice.exe" -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notlike "*\UninstallHelper*" -and $_.DirectoryName -like "*\program" } |
    Select-Object -First 1
if (-not $sofficeExe) { throw "解压目录中找不到 program\soffice.exe: $extractBase" }

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
    "readmes",               # 说明文档
    "share\wizards"          # 文档向导(headless 不需要)
)
# 注意: 以下目录**不可整删**,否则 soffice 首次为新用户创建配置目录失败
# (Fatal Error: User installation could not be completed):
#   - share\extensions —— 改为下方"删内容留骨架"。
#   - presets —— [fix: libreoffice-user-install-fail-win 2026-06-07] **必须保留**。
#       LibreOffice 首次建 profile 时从 presets/ 拷初始模板(autotext/basic/config/database/
#       gallery,仅 ~200KB)。2026-06-03 第二轮剥皮把它列进删除清单整删 → Win/Mac 两端
#       干净机器上 100% 必报此 fatal error,正是 extensions 修复后 2026.7.0 仍复现的残留真因。
#       Win 端 C 实验 + Mac 端 A/B/C 对照单变量锁定就是 presets;代价 ~200KB 可忽略,保留即修复。

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

# -- Step 3.5: 冷启动 smoke test --------------------------------------------
# [feat: lo-bundle-coldstart-smoke-gate 2026-06-08] 机制化防"过度剥皮"再发生(对称 macOS prepare-lo-bundle.sh)。
# 起源:presets/extensions 这类 profile bootstrap 硬依赖被剥皮删掉 → 干净机器(冷 profile)100% 报
# "User installation could not be completed",但打包机有热 profile(%APPDATA%\LibreOffice\4 已存在)测不出 → 直达线上。
# 本闸不认目录名、只认行为:用全新空 -env:UserInstallation 真跑一次转换,失败即 throw,残缺 bundle 产不出。
# 注:① 用 .com 控制台变体(.exe 会立即返回);② 用 Start-Process + WaitForExit(超时)防失败时模态
#    fatal-error 对话框把脚本挂死;③ profile 用全新空目录,file:/// + 正斜杠绝对路径;
#    ④ PS5.1 Start-Process -ArgumentList 数组不给含空格元素自动加引号 → TEMP 路径含空格
#      (C:\Users\My Name\...)会被拆裂 → 手动给含空白参数包双引号拼单条命令行;
#    ⑤ soffice 输出重定向到日志,失败时回显定位真实错因(成功仍静默)。
Write-Host "[3.5/4] 冷启动 smoke test(全新空 profile)..."
$smokeTmp = Join-Path $env:TEMP "deskfox-lo-smoke-$PID"
Remove-Item $smokeTmp -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path (Join-Path $smokeTmp "out") -Force | Out-Null
"DeskFox LO cold-start smoke test" | Out-File -FilePath (Join-Path $smokeTmp "smoke.txt") -Encoding utf8
$sofficeCom = Join-Path $loProgramDir "soffice.com"
$smokeBin   = if (Test-Path $sofficeCom) { $sofficeCom } else { Join-Path $loProgramDir "soffice.exe" }
$profUrl    = "file:///" + ($smokeTmp -replace '\\','/') + "/profile"
$smokeOut   = Join-Path $smokeTmp "out"
$smokeTxt   = Join-Path $smokeTmp "smoke.txt"
$rawArgs    = @("--headless","--norestore","--nologo","--nofirststartwizard",
    "-env:UserInstallation=$profUrl","--convert-to","pdf","--outdir",$smokeOut,$smokeTxt)
# 含空白的参数(路径/含空格 URL)包双引号,否则数组传参在空格处被 soffice 拆成多个参数
$smokeCmdline = ($rawArgs | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' '
$smokeOutLog  = Join-Path $smokeTmp "soffice.out.log"
$smokeErrLog  = Join-Path $smokeTmp "soffice.err.log"
$smokeProc    = Start-Process -FilePath $smokeBin -ArgumentList $smokeCmdline -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $smokeOutLog -RedirectStandardError $smokeErrLog
if (-not $smokeProc.WaitForExit(120000)) {
    # 120s 没出 = 大概率卡在 fatal-error 模态框(冷启动失败),杀掉防挂死
    try { $smokeProc.Kill() } catch {}
}
$smokePdf = Join-Path $smokeTmp "out\smoke.pdf"
if (Test-Path $smokePdf) {
    Write-Host "    [OK] smoke 通过 — 剥皮后 bundle 能冷启动建 profile + 转换"
    Remove-Item $smokeTmp -Recurse -Force -ErrorAction SilentlyContinue
} else {
    $sofficeLog = ((Get-Content $smokeErrLog, $smokeOutLog -ErrorAction SilentlyContinue) -join "`n")
    Remove-Item $smokeTmp -Recurse -Force -ErrorAction SilentlyContinue
    throw "[!] 冷启动 smoke test 失败 — 剥皮删了 profile bootstrap 必需目录!全新 profile 下 soffice 起不来(典型 'User installation could not be completed')。核对上面 stripFolders 是否误删 presets / extensions 等必需项;此 bundle 不可打包。`n--- soffice 输出 ---`n$sofficeLog"
}

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

# 剥皮后体积 sanity check(2026-06-03 code-review #5):脚本通篇 Test-Path 跳过 + SilentlyContinue,
# 一旦 loBaseDir 推导错位,所有剥皮静默跳过、bundle 仍 1GB+ 但脚本照报 [OK]。这里兜底告警:
# 剥皮成功后预期 ~636MB,远超 700MB 说明剥皮大概率未生效,提示运维核对上面各剥皮项是否都是 0 MB。
if (($finalSize / 1MB) -gt 700) {
    Write-Warning "[!] bundle 体积 $([math]::Round($finalSize/1MB)) MB 超过预期上限 700MB!"
    Write-Warning "    剥皮可能未生效(loBaseDir 推导错位?) — 请核对上面剥皮日志,若各项显示 0 MB 即未剥到。"
    Write-Warning "    不要直接打包此 bundle,否则安装包会暴增。"
}

Write-Host "下一步: 运行 build-deskfox-electron.ps1 将自动打入 NSIS installer"
Write-Host "=============================================="
