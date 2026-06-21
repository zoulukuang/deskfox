# [fork-only] DeskFox Electron 一键构建 wrapper(Windows 版)[feat: electron-replatform-windows] 2026-06-14
#
# 换基座(Tauri → Electron)后取代旧 build-deskfox.ps1 的 Windows 构建职责。
# 旧脚本走 `tauri build` + tauri-overrides + apply-icons(src-tauri);Electron 这些由 electron-builder
# + electron-builder.deskfox.config.ts 接管。本 wrapper 只负责:选 channel、就绪门槛、规避国内/换基座
# 踩坑,然后调 electron-builder --win。版本号注入由 deskfox config 自读 installer-versions.json(无需传参)。
#
# 流程(对称 macOS build-deskfox-electron.sh):
#   1. 预检版本号 key 存在(实际注入由 deskfox config 自读;dev-independent-version-line)
#   2. 确保 icon.ico 存在(deskfox config win.icon 引用;缺则 png-to-ico 现场生成,不碰 Tauri 的 apply-icons)
#   3. 杀运行中的 DeskFox(避免 dist-deskfox 输出被锁)
#   3.5 打包资源就绪校验:plugin dist + LibreOffice bundle(presets 非空硬卡)
#   4. electron-vite build(prebuild 编译 opencode Node 后端 + 三 bundle 到 out/)
#   5. electron-builder --win(--dir 当 -NoBundle 时)出 win-unpacked / NSIS 到 dist-deskfox/
#   5.5 post-build 验证:最终包内含 soffice.exe + 非空 presets
#
# 两个必备适配点(对齐 macOS,同源踩坑):
#   A. --publish never:否则 electron-builder 拉 publish.url 的 latest.yml 生成差量 blockmap,
#      dev channel manifest 未部署时请求挂起 600s 超时。
#   B. 绕过 Clash 代理(清空 *_PROXY):npmmirror 是国内镜像应直连,走代理会绕国外节点导致
#      electron / winCodeSign 校验请求超时。
#
# 用法:
#   .\packages\branding\scripts\build-deskfox-electron.ps1 -Env dev               # 完整出 NSIS installer
#   .\packages\branding\scripts\build-deskfox-electron.ps1 -Env dev -NoBundle     # 只出 win-unpacked(最快,本地测)
#   .\packages\branding\scripts\build-deskfox-electron.ps1 -Env prod
#   .\packages\branding\scripts\build-deskfox-electron.ps1 -Env local             # 本地测试版(独立身份+数据隔离,永不发布)
#
# 注:本脚本只产【未签名】包(DeskFox installer 不签名,治理:数字签名问题.md)。
#
# local 第 4 档(2026-06-17 起,规范《版本号与发布渠道规范》§3.11/§4.3/§5.3):
#   - 身份独立:appId ai.deskfox.app.local + 产物名「DeskFox 本地版」+ LOCAL 徽标 + 数据库 opencode-local.db
#     物理隔离(本机灌测试数据不污染正式/预览版)。以上由 electron-builder.deskfox.config.ts 按 channel=local 注入。
#   - 永不发布:始终 --dir 出 win-unpacked(不打 NSIS installer),不配 publish、无自动升级。
#   - 版本号:不建专属号线,config 回落平台裸号(windows key);本地版版本号只是显示牌,不 bump、不 commit。

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("dev", "beta", "prod", "local")]
    [string]$Env,

    [switch]$NoBundle
)

$ErrorActionPreference = "Stop"

$scriptDir   = $PSScriptRoot
$brandingDir = Split-Path -Parent $scriptDir                       # packages/branding/
$repoRoot    = Split-Path -Parent (Split-Path -Parent $brandingDir) # opencode-fork/
$desktop     = Join-Path $repoRoot "packages/desktop"
$versionsJson = Join-Path $brandingDir "installer-versions.json"

$isRelease = -not $NoBundle
# local 永不发布 → 始终 --dir 出 win-unpacked(不打 NSIS installer),对齐规范 §5.3 与 config 不配 publish。
# 与 -NoBundle 的区别:local 默认仍含 LibreOffice(本机要能测 office),-NoBundle 才跳过 LO。
$useDir = $NoBundle -or ($Env -eq "local")

# === 1. 日历版号(prod → windows;dev/beta → <env>-windows,独立号线;local → 回落平台裸号 windows)===
# 实际版本注入由 electron-builder.deskfox.config.ts 自读 installer-versions.json 完成
# (dev-independent-version-line:config 按 --win argv + channel 选号线)。此处仅预检 + 打印。
# local 无专属号线:config 取 versions[local-windows] ?? versions[windows] → 回落平台裸号;预检同样回落 windows。
$versionKey = if ($Env -eq "prod" -or $Env -eq "local") { "windows" } else { "$Env-windows" }
# UTF-8 显式读取:installer-versions.json 含中文 _doc,PS5.1 Get-Content 默认按 GBK 解码会读乱 → JSON 解析崩。
$versions = [System.IO.File]::ReadAllText($versionsJson, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
$appVersion = $versions.$versionKey
if ([string]::IsNullOrWhiteSpace($appVersion)) {
    throw "[deskfox] installer-versions.json 缺 key '$versionKey'(先跑 bump-installer-version.ps1)"
}
Write-Host "[deskfox] channel=$Env  version=$appVersion  (key=$versionKey,实际注入由 deskfox config 自读)"

# === 2. 重新生成 icon.ico(deskfox config win.icon 引用)===
# 注:不调 Tauri 时代的 apply-icons.ps1(它拷到 src-tauri/,electron 不需要),只生成 config 直接引用的那个 ico。
# ⚠️ icon.ico 是 gitignored 现场产物。历史上这里是"仅缺失时生成",一旦磁盘残留旧版(尺寸不全)就被
#    静默复用 → electron-builder NSIS 要求 icon >=256x256,陈旧 128 ico 直接打包失败(同飞书 dist 陈旧教训:
#    只查存在不查新鲜度)。改为【每次从 ico-source 全量重生成】+ 校验含 >=256,杜绝陈旧/缺尺寸 ico 混入。
$iconEnv = if ($Env -eq "prod") { "prod" } else { "dev" }
$envAssets = Join-Path $brandingDir "src/assets/icons/$iconEnv"
$icoOut = Join-Path $envAssets "icon.ico"
$icoSrc = Join-Path $envAssets "ico-source"
$pngs = Get-ChildItem -Path $icoSrc -Filter "*.png" |
    Where-Object { $_.BaseName -match '^\d+$' } |
    Sort-Object @{ Expression = { [int]$_.BaseName } }
if ($pngs.Count -eq 0) { throw "[deskfox] ico-source 下无 <size>.png: $icoSrc" }
if (-not ($pngs | Where-Object { [int]$_.BaseName -ge 256 })) {
    throw "[deskfox] ico-source 缺 >=256 的 <size>.png(electron-builder NSIS 要求 icon >=256x256): $icoSrc"
}
Write-Host "[deskfox] 重新生成 icon.ico ($iconEnv,$($pngs.Count) 尺寸: $(($pngs.BaseName) -join ','))…"
Push-Location $repoRoot
try {
    bun packages/branding/scripts/png-to-ico.ts $icoOut @($pngs.FullName)
    if ($LASTEXITCODE -ne 0) { throw "[deskfox] png-to-ico.ts 失败 (env=$iconEnv)" }
} finally { Pop-Location }

# === 3. 杀运行中的 DeskFox(避免 dist-deskfox 输出目录被运行中的 .exe 锁)===
Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "DeskFox*" -or $_.Name -in @("OpenCode", "opencode-cli") } |
    Stop-Process -Force -ErrorAction SilentlyContinue

# === 3.5 打包资源就绪校验(对齐 main build-deskfox §1.9 分层:脚本管"发布物必须有",config 管注入)===
# 发布物(非 -NoBundle)= 发布给用户,资源缺了 = 功能在用户机上直接没有。

# 3.5a plugin dist —— 打包前【从最新源码重建】feishu-bridge / media-gen,再校验(对称 .sh §3.5a)。
# 根治"陈旧 dist 静默混入"(2026-06-15 dev-feishu-binding-missing + media-gen 同病):源码 2026-06-12 把
#   Bun.serve 适配成 node:http(Electron 边车跑 Node 不再是 Bun),但 dist 没人重建仍是旧产物 → 打进包的
#   plugin.js 仍调 Bun.serve → Node 下抛 "Bun is not defined" → 飞书/media-gen 插件 server 起不来。
#   原 Windows .ps1 只"检查存在不重建"(.sh 已修但 .ps1 漏了)→ 本次镜像过来:改为"先重建 + Bun 守卫"。
#   build-*-plugin.ps1 自带时间戳判断,无源码变更则秒跳过,不拖慢迭代;-NoBundle 自测也重建(自测包也含插件)。
Write-Host "[deskfox] 重建插件 dist(feishu-bridge / media-gen,源码无变更则跳过)…"
& "$scriptDir/build-feishu-plugin.ps1"
if ($LASTEXITCODE -ne 0) { throw "[deskfox] build-feishu-plugin.ps1 失败" }
& "$scriptDir/build-media-gen-plugin.ps1"
if ($LASTEXITCODE -ne 0) { throw "[deskfox] build-media-gen-plugin.ps1 失败" }

$feishuPlugin = Join-Path $brandingDir "plugin/feishu-bridge/dist/plugin.js"
$mediaPlugin  = Join-Path $repoRoot "packages/media-gen/dist/plugin.js"
foreach ($p in @($feishuPlugin, $mediaPlugin)) {
    if (-not (Test-Path $p)) {
        throw "[deskfox] plugin dist 重建后仍缺失: $p"
    }
    # Electron 边车跑 Node:plugin bundle 不得残留 Bun.serve(否则插件 server 启动即 "Bun is not defined")。
    # 源码应已走 node-serve shim(node:http);残留 = 源码没适配/构建目标错。
    if (Select-String -Path $p -Pattern 'Bun\.serve' -Quiet) {
        Write-Host "[deskfox] X plugin dist 仍含 Bun.serve → Node 边车下插件 server 起不来: $p" -ForegroundColor Red
        throw "[deskfox] 确认对应 src 已用 node-serve(node:http)替换 Bun.serve 后重试。"
    }
}
Write-Host "[deskfox] plugin dist 就绪且无 Bun.serve 残留 ✓"

# 3.5b LibreOffice bundle —— office 预览/转换依赖(Windows program/soffice.exe 结构)。
# presets/ 是 office 转换【硬依赖】(实测删之 profile 建成但 convert 无输出)→ 硬卡非空。
# 最终包是否真含 presets 由 §5.5 post-build 复验(堵 electron-builder 漏拷)。
$loWin = Join-Path $brandingDir "libreoffice-bundle/windows"
$loSoffice = Join-Path $loWin "program/soffice.exe"
$loPresets = Join-Path $loWin "presets"
if (Test-Path $loSoffice) {
    $presetsHasFiles = (Test-Path $loPresets) -and `
        ((Get-ChildItem $loPresets -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0)
    if (-not $presetsHasFiles) {
        Write-Host "[deskfox] X LO bundle 缺 presets(或为空)— office 转换硬依赖,打包必致干净机器功能失效。" -ForegroundColor Red
        throw "[deskfox] 重跑 prepare-lo-bundle.ps1 重做 bundle(内置冷启动 smoke 闸,保证产出健康 bundle)。"
    }
    $loSizeMB = [math]::Round((Get-ChildItem $loWin -Recurse -File -EA SilentlyContinue | Measure-Object Length -Sum).Sum / 1MB)
    Write-Host "[deskfox] LO bundle 健康(${loSizeMB}MB,presets 非空)→ deskfox config 注入 app 根 libreoffice/(extraFiles)"
} elseif ($isRelease) {
    Write-Host "[deskfox] X 发布物构建但 LO bundle 不存在: $loSoffice" -ForegroundColor Red
    Write-Host "[deskfox]   绝不静默出不含 LibreOffice 的发布包(office 预览/导出会失效)。先跑 prepare-lo-bundle.ps1 做健康 bundle。"
    throw "[deskfox]   (仅本机 win-unpacked 自测可加 -NoBundle 跳过 LO)"
} else {
    Write-Warning "[deskfox] LO bundle 不存在(-NoBundle 自测放行,本机 office 功能不可用): $loSoffice"
}

# === 4. electron-vite build(自动跑 prebuild:编译 opencode Node 后端 + copy-icons)===
$env:OPENCODE_CHANNEL = $Env
if (-not $env:ELECTRON_MIRROR) { $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/" }
if (-not $env:ELECTRON_BUILDER_BINARIES_MIRROR) {
    $env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
}

Write-Host "[deskfox] electron-vite build…"
Push-Location $desktop
try {
    bun run build
    if ($LASTEXITCODE -ne 0) { throw "[deskfox] electron-vite build 失败" }
} finally { Pop-Location }

# === 5. electron-builder 打包(绕代理 + --publish never;-NoBundle → --dir 只出 win-unpacked)===
# 绕过 Clash 代理:清空 *_PROXY(仅本进程作用域,不影响系统),npmmirror 直连。
$proxyBackup = @{}
foreach ($pv in @("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy")) {
    $proxyBackup[$pv] = [Environment]::GetEnvironmentVariable($pv)
    Remove-Item "Env:$pv" -ErrorAction SilentlyContinue
}

$ebArgs = @("--win", "--publish", "never", "--config", "electron-builder.deskfox.config.ts")
if ($useDir) { $ebArgs = @("--dir") + $ebArgs }

Write-Host "[deskfox] electron-builder $($ebArgs -join ' ')  (绕 Clash 代理直连 npmmirror)…"
Push-Location $desktop
try {
    # bun 在 .bin 生成 electron-builder.exe(原生 shim),非 .cmd;回退到无扩展名(PATHEXT 解析)。
    $ebBin = Join-Path $desktop "node_modules/.bin/electron-builder.exe"
    if (-not (Test-Path $ebBin)) { $ebBin = Join-Path $desktop "node_modules/.bin/electron-builder" }
    & $ebBin @ebArgs
    if ($LASTEXITCODE -ne 0) { throw "[deskfox] electron-builder 失败 (exit $LASTEXITCODE)" }
} finally {
    Pop-Location
    # 还原代理 env(本进程)
    foreach ($pv in $proxyBackup.Keys) {
        if ($null -ne $proxyBackup[$pv]) { Set-Item "Env:$pv" $proxyBackup[$pv] }
    }
}

# === 5.5 post-build 验证:最终包内真含 soffice.exe + 非空 presets(挡"LO 没被收进最终包")===
# 对齐 macOS §5.5。LO 源健康 ≠ 进了最终包(electron-builder 可能漏拷),必须复验。
$unpacked = Join-Path $desktop "dist-deskfox/win-unpacked"
if ((Test-Path $loSoffice) -and (Test-Path $unpacked)) {
    # extraFiles 落 app 根(与 exe 同级),非 resources/ 下 —— 对齐后端 dirname(execPath)\libreoffice。
    $loDst = Join-Path $unpacked "libreoffice"
    $verifySoffice = Join-Path $loDst "program/soffice.exe"
    if (-not (Test-Path $verifySoffice)) {
        Write-Host "[deskfox] X 打包后最终包内未找到 soffice.exe: $verifySoffice" -ForegroundColor Red
        throw "[deskfox] LO 源健康但没注入最终包(疑 extraFiles/打包问题)。绝不发布不含 LibreOffice 的包。"
    }
    $verifyPresets = Join-Path $loDst "presets"
    $presetsOk = (Test-Path $verifyPresets) -and `
        ((Get-ChildItem $verifyPresets -Recurse -File -EA SilentlyContinue | Measure-Object).Count -gt 0)
    if (-not $presetsOk) {
        Write-Host "[deskfox] X 打包后最终包内 LO presets 缺失/为空: $verifyPresets" -ForegroundColor Red
        throw "[deskfox] presets 是 office 转换硬依赖,源健康但没进最终包 → office 功能在用户机静默失效。"
    }
    Write-Host "[deskfox] post-build verify: 最终包含 soffice.exe + 非空 presets ✓"
}

# === 6. 产物路径 ===
$out = Join-Path $desktop "dist-deskfox"
Write-Host ""
Write-Host "[deskfox] OK 构建完成,产物:" -ForegroundColor Green
if ($useDir) {
    Get-ChildItem $unpacked -Filter "*.exe" -ErrorAction SilentlyContinue |
        ForEach-Object { Write-Host "  exe : $($_.FullName)" }
    Write-Host "  dir : $unpacked"
} else {
    Get-ChildItem $out -Filter "*.exe" -ErrorAction SilentlyContinue |
        ForEach-Object { Write-Host "  $($_.FullName)" }
}
