# [fork-only] DeskFox 一键构建 wrapper
#
# 流程:
#   1. apply-icons.ps1   把 DeskFox PNG/.ico 临时拷到 src-tauri/icons/{env}/
#   2. tauri build       --config tauri-overrides/<env>.json(productName / mainBinaryName 覆盖)
#   3. restore-icons.ps1 git checkout HEAD -- src-tauri/icons/(还原工作树)
#
# 用法:
#   .\packages\branding\scripts\build-deskfox.ps1 -Env dev
#   .\packages\branding\scripts\build-deskfox.ps1 -Env prod
#   .\packages\branding\scripts\build-deskfox.ps1 -Env beta
#
# 不带 -NoBundle 时跑完整 bundle(NSIS .msi 等);加 -NoBundle 跳过 bundler(SignTool 没装时用)

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("dev", "beta", "prod")]
    [string]$Env,

    [switch]$NoBundle
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$repoRoot = Split-Path -Parent $root  # opencode-fork/
$override = Join-Path $root "branding/tauri-overrides/$Env.json"

if (-not (Test-Path $override)) {
    throw "tauri override not found: $override"
}

# 0. Ensure sidecar built, mtime >= packages/opencode/src/**/*.ts latest
# 绕过上游 packages/desktop/scripts/predev.ts:它会按 SIDECAR_BINARIES 表跑 build --single --baseline,
# Bun.compile 内部需要从 GitHub 拉 bun-windows-x64-baseline 运行时(~190MB),clash/国内网络常超时失败。
# DeskFox 用户群默认现代 CPU(都有 AVX2),baseline 二进制不需要兜底,直接 build --single 即可,
# 输出 dist/opencode-windows-x64/bin/opencode.exe,复用本机已有的 bun runtime,零下载。
# Mac 侧 build-deskfox.sh 自己控,不受影响。

# FORK-BEGIN: feishu-pipeline-401-fix(2026-05-23)
# 锁 sidecar baked CHANNEL=prod,避免 git branch 名漂移触发上游 HTTPAPI 默认 ON 路径。
# 完整背景见 build-deskfox.sh 同标记段(单一来源,这边不复写)。
# 简版:CHANNEL=prod → InstallationChannel="prod" → 不命中 HTTPAPI_DEFAULT_ON_CHANNELS →
# HTTPAPI OFF → 走稳定的 Hono legacy stack,规避上游 effect-httpapi 两个已知 bug。
# 双端必须一致,否则下次 Mac build 漂回 dev branch 名又会撞同样 bug。
$env:OPENCODE_CHANNEL = "prod"
# FORK-END

if (-not $env:RUST_TARGET) {
    # ARM64 Windows: add detect branch when needed
    $env:RUST_TARGET = "x86_64-pc-windows-msvc"
}
$sidecarPath = Join-Path $repoRoot "packages/desktop/src-tauri/sidecars/opencode-cli-$($env:RUST_TARGET).exe"
$opencodeSrcDir = Join-Path $repoRoot "packages/opencode/src"

$needBuild = $false
if (-not (Test-Path $sidecarPath)) {
    Write-Output "[deskfox] sidecar not found, will build: $sidecarPath"
    $needBuild = $true
} else {
    $sidecarMtime = (Get-Item $sidecarPath).LastWriteTime
    $latestSrcMtime = (Get-ChildItem -Recurse -File -Path $opencodeSrcDir -Include "*.ts","*.tsx" -ErrorAction SilentlyContinue |
        Measure-Object -Property LastWriteTime -Maximum).Maximum
    if ($latestSrcMtime -and $latestSrcMtime -gt $sidecarMtime) {
        Write-Output "[deskfox] sidecar stale ($($sidecarMtime.ToString('yyyy-MM-dd HH:mm')) < src $($latestSrcMtime.ToString('yyyy-MM-dd HH:mm'))), will rebuild"
        $needBuild = $true
    } else {
        Write-Output "[deskfox] sidecar up-to-date: $sidecarPath"
    }
}

if ($needBuild) {
    Write-Output "[deskfox] building sidecar: bun run build --single (no --baseline, RUST_TARGET=$($env:RUST_TARGET))..."
    Push-Location (Join-Path $repoRoot "packages/opencode")
    try {
        bun run build --single
        if ($LASTEXITCODE -ne 0) {
            throw "[deskfox] sidecar build failed: bun run build --single exited $LASTEXITCODE. Hint: 检查 bun 输出 / clash 状态 / @opentui/core 安装"
        }
    } finally {
        Pop-Location
    }

    $srcBin = Join-Path $repoRoot "packages/opencode/dist/opencode-windows-x64/bin/opencode.exe"
    if (-not (Test-Path $srcBin)) {
        throw "[deskfox] sidecar build reported success but no binary at $srcBin"
    }
    if ((Get-Item $srcBin).LastWriteTime -lt (Get-Date).AddMinutes(-10)) {
        throw "[deskfox] sidecar binary at $srcBin is stale (>10 min old), build 可能跳过/静默失败"
    }
    Write-Output "[deskfox] using sidecar: $srcBin"

    # CI 干净 checkout 时 sidecars/ 目录可能不存在(本地有是因为之前 build 过留下),Copy-Item 不会自动建父目录
    $sidecarDir = Split-Path -Parent $sidecarPath
    if (-not (Test-Path $sidecarDir)) {
        New-Item -ItemType Directory -Force -Path $sidecarDir | Out-Null
        Write-Output "[deskfox] created missing sidecars/ dir: $sidecarDir"
    }
    Copy-Item -Force $srcBin $sidecarPath
    $size = (Get-Item $sidecarPath).Length
    Write-Output "[deskfox] sidecar updated: $sidecarPath ($size bytes)"
}

# 0.5. 打飞书桥接 plugin(进 installer 资源)
# 让 installer 装完即可用 — runtime 由 lib.rs setup hook 把 plugin 路径注入 user opencode 配置
& (Join-Path $PSScriptRoot "build-feishu-plugin.ps1")

# 0.6. 打 media-gen 创作 plugin(进 installer 资源,同飞书)[feat: media-gen-bundle] 2026-05-27
# tauri.conf.json resources 引用 branding/plugin/media-gen/dist/plugin.js,必须在 tauri build 前产出
& (Join-Path $PSScriptRoot "build-media-gen-plugin.ps1")

# 1. apply(按 env 选样式)
& (Join-Path $PSScriptRoot "apply-icons.ps1") -Env $Env

# 1.5 注入 VITE_DESKFOX_ENV 让前端 logo.tsx Mark 组件按 env 选 branded 样式
$env:VITE_DESKFOX_ENV = $Env

# FORK: [启用自动升级] 2026-06-05 — 注入 minisign 签名私钥(Tauri updater 需要)
# 私钥来源:~/.deskfox-signing/config.env(跟 Apple 代码签名配置同文件)或环境变量
# 不存在时不 block(Tauri build 会产出 unsigned updater artifacts,功能层面仍可用,只是 updater 无法验签)
$signingConfig = Join-Path $env:USERPROFILE ".deskfox-signing\config.env"
if (Test-Path $signingConfig) {
    $configContent = Get-Content $signingConfig -Raw -Encoding UTF8
    # 注:正则要求 TAURI_SIGNING_PRIVATE_KEY 紧跟 = ，不会误匹配 _PASSWORD 行(后者跟的是 _ 不是 =)
    $keyMatch = [regex]::Match($configContent, "TAURI_SIGNING_PRIVATE_KEY\s*=\s*([^\r\n]+)")
    if ($keyMatch.Success) {
        $env:TAURI_SIGNING_PRIVATE_KEY = $keyMatch.Groups[1].Value.Trim()
        Write-Output "[deskfox] TAURI_SIGNING_PRIVATE_KEY loaded from ~/.deskfox-signing/config.env"
    } else {
        Write-Output "[deskfox] ~/.deskfox-signing/config.env exists but no TAURI_SIGNING_PRIVATE_KEY — updater artifacts will be unsigned"
    }
    # FORK: [启用自动升级] 2026-06-06 — 私钥【有密码】,必须同步注入密码,否则 createUpdaterArtifacts
    # 签名报 "incorrect updater private key password: Wrong password"。Mac 端 build-deskfox.sh 用
    # `source config.env` 一次性导出全部变量(含密码)天然带上;Win 只 regex 抠了 key 漏了密码 ->
    # 之前"撞运气"靠 ambient env,fresh shell 必失败。此处显式从同文件加载(空值也显式设,防 ambient 串台)。
    $pwMatch = [regex]::Match($configContent, "TAURI_SIGNING_PRIVATE_KEY_PASSWORD\s*=\s*([^\r\n]*)")
    if ($pwMatch.Success) {
        $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $pwMatch.Groups[1].Value.Trim()
        Write-Output "[deskfox] TAURI_SIGNING_PRIVATE_KEY_PASSWORD loaded from config.env"
    } else {
        $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
        Write-Output "[deskfox] no TAURI_SIGNING_PRIVATE_KEY_PASSWORD field -> using empty password"
    }
} elseif ($env:TAURI_SIGNING_PRIVATE_KEY) {
    Write-Output "[deskfox] TAURI_SIGNING_PRIVATE_KEY set from environment"
} else {
    Write-Output "[deskfox] TAURI_SIGNING_PRIVATE_KEY not set — updater artifacts will be unsigned (updater check will fail without valid signature)"
}

# 1.6 FORK: [启用自动升级/版本号注入] 2026-06-05 — 注入真实版本号(修历史 app version=0.0.0)
# Tauri generate_context! 宏在【编译时】从 on-disk tauri.conf.json 烧录 app version。
# 上游写的 version 是 "../package.json",Tauri v2 当它非法 semver 字面量 → 回落 Cargo 默认 0.0.0;
# 且 --config(走 env)不触发 cargo 重编。实测唯一可靠杠杆:patch on-disk tauri.conf.json
# (tauri-build 有 rerun-if-changed,强制重编宏)→ 版本号才真进二进制(updater 用 package_info().version)。
# 版本号 scheme 见 docs/governance/版本号与发布渠道规范.md §三。build 后 git 还原 tauri.conf.json。
# 注意:本块【代码行】必须纯 ASCII。PS5.1 按 GBK 读 .ps1 时,中文紧邻代码引号会吞掉引号 → 解析崩。
$versionsJson = Join-Path $root "branding/installer-versions.json"
$appVersion = (Get-Content $versionsJson -Raw -Encoding UTF8 | ConvertFrom-Json).windows
if (-not $appVersion) { throw "[deskfox] installer-versions.json missing 'windows' version field" }
$baseConf = Join-Path $repoRoot "packages/desktop/src-tauri/tauri.conf.json"
$confText = [System.IO.File]::ReadAllText($baseConf)
$confRe = [regex]'"version"\s*:\s*"[^"]*"'
$confText = $confRe.Replace($confText, ('"version": "' + $appVersion + '"'), 1)
# FORK: 本地无 Windows 代码签名证书(非 GitHub Actions)时剥离 bundle.windows.signCommand。
# 否则 Tauri NSIS bundler 找不到 SignTool 直接报错,连【未签名安装包】都出不来。
# 剥离后产【未签名 NSIS + minisign .sig】:updater 用 minisign 验签照常升级(Authenticode 只影响
# "未知发布者"警告,不是升级前提)。CI(GITHUB_ACTIONS + Azure Trusted Signing)仍保留 signCommand。
if ($env:GITHUB_ACTIONS -ne "true") {
    $confText = [regex]::Replace($confText, '"signCommand"\s*:\s*\{[^}]*\}\s*,', '')
    Write-Output "[deskfox] no local Authenticode cert -> stripped signCommand, building UNSIGNED installer (updater still verified by minisign)"
}
[System.IO.File]::WriteAllText($baseConf, $confText, (New-Object System.Text.UTF8Encoding $false))
# 只靠 on-disk patch:CLI 读 on-disk tauri.conf.json(已 patch version)+ merge override → 编译/bundle
# 版本都拿到 2026.6.0。不用内联 --config JSON(PS 调原生 exe 会吞双引号,JSON 失效)。
Write-Output "[deskfox] app version injected -> $appVersion (tauri.conf.json on-disk patch)"

# 1.9 FORK: [启用自动升级] 2026-06-06 — Windows LO bundle 注入(对称 build-deskfox.sh step 1.9)
# 历史:Windows 的精简 LibreOffice 打包原靠 DeskFox.iss [Files] 段;Inno->NSIS 切换时 .iss 删了,
# LO 注入随之丢失 -> NSIS 安装包不含 LibreOffice。改用 Tauri --config 动态注入 bundle.resources,
# 把 branding/libreoffice-bundle/windows -> 安装目录 libreoffice/(office-installer.ts bundledSofficePath
# Win 分支期望 {exe dir}\libreoffice\program\soffice.exe;路径相对 packages/desktop/src-tauri/,同 Mac)。
# 注:PS 调原生 exe 会吞内联 --config JSON 的双引号(见 1.6 段踩坑)-> 写临时 JSON 文件,传文件路径规避。
# 本块【代码行】必须纯 ASCII(PS5.1 GBK 读 .ps1,中文紧邻引号会吞引号)。
$loBundleDir = Join-Path $root "branding/libreoffice-bundle/windows"
$loSoffice = Join-Path $loBundleDir "program/soffice.exe"
$loConfigFile = $null
if (Test-Path $loSoffice) {
    $loSizeMB = [math]::Round(((Get-ChildItem -Recurse -File $loBundleDir | Measure-Object -Property Length -Sum).Sum / 1MB))
    Write-Output "[deskfox] LO bundle found: $loBundleDir (${loSizeMB}MB) -> injecting as Tauri resource 'libreoffice'"
    $loJson = '{"bundle":{"resources":{"../../branding/libreoffice-bundle/windows":"libreoffice"}}}'
    $loConfigFile = Join-Path $env:TEMP "deskfox-lo-resources.json"
    [System.IO.File]::WriteAllText($loConfigFile, $loJson, (New-Object System.Text.UTF8Encoding $false))
} else {
    Write-Output "[deskfox] LO bundle not found: $loSoffice"
    Write-Output "[deskfox]   building WITHOUT pre-bundled LibreOffice (users will download on first use)"
    Write-Output "[deskfox]   run prepare-lo-bundle.ps1 to prepare the bundle"
}

# 2. tauri build
Push-Location (Join-Path $repoRoot "packages/desktop")
try {
    $configArgs = @("--config", $override)
    if ($loConfigFile) { $configArgs += @("--config", $loConfigFile) }  # 第二个 --config deep-merge LO resources
    if ($NoBundle) {
        bun run tauri build --no-bundle @configArgs
    } else {
        bun run tauri build @configArgs
    }
    $buildExit = $LASTEXITCODE
} finally {
    Pop-Location
    # 还原 tauri.conf.json(版本号只在 build 期间临时改,不入仓)
    & git -C $repoRoot checkout HEAD -- packages/desktop/src-tauri/tauri.conf.json 2>$null
    # 清理临时 LO config 文件
    if ($loConfigFile -and (Test-Path $loConfigFile)) { Remove-Item -Force $loConfigFile -ErrorAction SilentlyContinue }
}

# 3. restore(无论 build 成败都还原)
& (Join-Path $PSScriptRoot "restore-icons.ps1")

if ($buildExit -ne 0) {
    Write-Warning "tauri build exited with code $buildExit (NSIS SignTool missing 是已知挂账,exe 仍 build 出来了)"
}

# 3.6 FORK: [启用自动升级] 2026-06-06 — updater .sig 兜底补签
# 实证:tauri build 的 createUpdaterArtifacts 构建期签名在含 LibreOffice 资源(~190MB 包)时偶发
# "incorrect updater private key password: Wrong password"(同一 key/空密码,手动 tauri signer sign
# 100% 成功;日志先 "Deriving...done" 再报错,疑似构建器内部二次签名时 env 错乱),且此时 buildExit=1
# 但 .exe 已产出。手动 tauri signer sign 从 env 读 TAURI_SIGNING_PRIVATE_KEY,deterministic 可靠。
# 此处检测 NSIS 安装包:若缺 .sig 或 .sig 旧于安装包,自动补签,保证 /ship 步骤 7.5a 永远拿得到
# 与安装包匹配的签名,不受构建期签名抽风影响。仅出 bundle 且 env 有签名私钥时执行。
if (-not $NoBundle -and $env:TAURI_SIGNING_PRIVATE_KEY) {
    $nsisDir = Join-Path $repoRoot "packages/desktop/src-tauri/target/release/bundle/nsis"
    if (Test-Path $nsisDir) {
        $setupExe = Get-ChildItem -Path $nsisDir -Filter "*-setup.exe" -File -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($setupExe) {
            $sigPath = "$($setupExe.FullName).sig"
            $needSign = (-not (Test-Path $sigPath)) -or ((Get-Item $sigPath).LastWriteTime -lt $setupExe.LastWriteTime)
            if ($needSign) {
                Write-Output "[deskfox] updater .sig 缺失/旧于安装包 -> 手动补签 $($setupExe.Name)"
                Push-Location (Join-Path $repoRoot "packages/desktop")
                try {
                    bun run tauri signer sign $setupExe.FullName
                    if ($LASTEXITCODE -eq 0 -and (Test-Path $sigPath) -and ((Get-Item $sigPath).LastWriteTime -ge $setupExe.LastWriteTime)) {
                        Write-Output "[deskfox] OK updater .sig 补签成功 -> $sigPath"
                    } else {
                        Write-Warning "[deskfox] updater .sig 补签失败(exit=$LASTEXITCODE)— /ship 发版前需手动 tauri signer sign"
                    }
                } finally { Pop-Location }
            } else {
                Write-Output "[deskfox] updater .sig 已存在且新于安装包,无需补签"
            }
        }
    }
}

# 3.5 开发机 jsonc 清理(防多档累积 → multi-instance 双推 message)
# 决策同 Mac 端 build-deskfox.sh — 产品 inject 逻辑不做"同 plugin 多物理路径"清理,开发机 build 后顺手清,
# 下次 DeskFox 启动 setup hook 自动 inject 当前 .exe 路径(单 entry 正常状态)。
# [feat: feishu-plugin-dedup-decision] 2026-05-12
# [feat: build-script-json-fallback] 2026-05-12 — 同时检测 .jsonc + .json(对齐 setup hook
#   resolve_user_config_path,user 实际用哪个就清哪个;之前只查 .jsonc 漏掉 .json 用户)
if ($buildExit -eq 0) {
    $configDir = Join-Path $env:USERPROFILE ".config\opencode"
    foreach ($fileName in @("opencode.jsonc", "opencode.json")) {
        $jsonc = Join-Path $configDir $fileName
        if (-not (Test-Path $jsonc)) { continue }
        # UTF-8 读写(PS5.1 Get-Content/Set-Content 默认 ANSI/GBK,会把含中文的配置写成非 UTF-8,
        # Rust setup hook serde 读时报 "stream did not contain valid UTF-8" → 注入全废)。
        # [feat: media-gen-bundle] 2026-05-27 修此潜伏编码 bug。
        $raw = [System.IO.File]::ReadAllText($jsonc)
        $feishuMatches = [regex]::Matches($raw, "plugin/feishu-bridge")
        if ($feishuMatches.Count -gt 1) {
            Write-Output ""
            Write-Output "[deskfox] $fileName 发现 $($feishuMatches.Count) 个 feishu-bridge plugin entry,清理(下次 DeskFox 启动 setup hook 自动 inject 当前 .exe)..."
            Copy-Item $jsonc "$jsonc.bak.build-cleanup" -Force
            # 删除所有含 plugin/feishu-bridge 的行
            $cleaned = ($raw -split "`n" | Where-Object { $_ -notmatch "plugin/feishu-bridge" }) -join "`n"
            # 修复:plugin 数组最后一项可能留悬空逗号(",\n  ]" → "\n  ]")
            $cleaned = [regex]::Replace($cleaned, ",(\s*\])", '$1')
            [System.IO.File]::WriteAllText($jsonc, $cleaned, (New-Object System.Text.UTF8Encoding($false)))
            Write-Output "[deskfox] OK 已清,原文件备份至 $jsonc.bak.build-cleanup"
        }

        # media-gen 创作 plugin 清理(2026-05-27,media-gen-bundle):移除旧开发仓 dev 路径条目
        # (packages/media-gen)+ 任何多余 plugin/media-gen 条目;下次启动 setup hook 注入当前 .exe 资源路径单条。
        # 与飞书同理,只在开发机生效(end user 装包后不跑 build-deskfox,靠 setup hook retain 自去重)。
        $rawMg = [System.IO.File]::ReadAllText($jsonc)
        $mgMatches = [regex]::Matches($rawMg, "media-gen")
        if ($mgMatches.Count -ge 1) {
            Write-Output "[deskfox] $fileName 发现 $($mgMatches.Count) 个 media-gen plugin entry,清理(下次启动 setup hook 注入当前资源路径)..."
            if (-not (Test-Path "$jsonc.bak.build-cleanup")) { Copy-Item $jsonc "$jsonc.bak.build-cleanup" -Force }
            $cleanedMg = ($rawMg -split "`n" | Where-Object { $_ -notmatch "media-gen" }) -join "`n"
            $cleanedMg = [regex]::Replace($cleanedMg, ",(\s*\])", '$1')
            [System.IO.File]::WriteAllText($jsonc, $cleanedMg, (New-Object System.Text.UTF8Encoding($false)))
            Write-Output "[deskfox] OK media-gen 已清"
        }
    }
}

# 4. 提示产物路径
$exePath = Join-Path $repoRoot "packages/desktop/src-tauri/target/release/DeskFox.exe"
if (Test-Path $exePath) {
    Write-Output ""
    Write-Output "✓ DeskFox.exe ready at: $exePath"
} else {
    Write-Warning "DeskFox.exe not found — check build output above"
}
