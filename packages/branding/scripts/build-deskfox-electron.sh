#!/usr/bin/env bash
# [fork-only] DeskFox Electron 一键构建 wrapper(macOS 版)[feat: electron-replatform] 2026-06-14
#
# 换基座(Tauri → Electron)后取代旧 build-deskfox.sh 的 macOS 构建职责。
# 旧脚本走 `tauri build` + 手动 codesign/hdiutil/notarytool;Electron 这些由 electron-builder 内置,
# 本 wrapper 只负责:选 channel、注入日历版号、规避两个国内/换基座踩坑,然后调 electron-builder。
#
# 流程:
#   1. 预检版本号 key 存在(实际注入由 deskfox config 自读;dev-independent-version-line)
#   2. 确保 icon.icns 存在(缺则 apply-icons 现场生成)
#   3. electron-vite build(predev 编译 opencode Node 后端 + 三 bundle 到 out/)
#   4. electron-builder --mac(--dir 当 --no-bundle 时)出 .app / .dmg / .zip 到 dist-deskfox/
#
# 两个必备适配点(2026-06-14 阶段0 实测定位):
#   A. --publish never:否则 electron-builder 拉 publish.url 的 latest.yml 生成差量 blockmap,
#      dev channel manifest 未部署时请求挂起 600s 超时。
#   B. 绕过 Clash 代理(env -u …_PROXY):npmmirror 是国内镜像应直连,走代理会绕国外节点导致
#      electron SHASUMS256.txt 校验请求超时(大 zip 侥幸过、小 checksum 必挂)。
#
# 用法:
#   bash .../build-deskfox-electron.sh -Env dev                       # 预览版,完整出 dmg+zip+app(未签名)
#   bash .../build-deskfox-electron.sh -Env dev --no-bundle           # 预览版,只出 .app(最快,未签名)
#   bash .../build-deskfox-electron.sh -Env dev --sign --no-bundle    # 签名 .app(深签含 soffice;不公证,快)
#   bash .../build-deskfox-electron.sh -Env prod --sign --notarize    # 正式分发:深签 + Apple 公证 + staple
#   bash .../build-deskfox-electron.sh -Env local                     # 本地测试版,独立身份+数据隔离,始终 --dir 出 .app
#   bash .../build-deskfox-electron.sh -Env local --no-bundle         # 本地测试版最快(额外跳过 LibreOffice)
#
# `local` = 第 4 档本地测试版(2026-06-17,对齐 Win wrapper):独立 appId ai.deskfox.app.local +
#   opencode-local.db 数据隔离 + LOCAL 徽标 + 永不发布(始终 --dir,不打 installer);版本号回落平台裸号、不 bump。
#   身份/隔离由双端共用的 electron-builder.deskfox.config.ts 注入。规则详见《版本号与发布渠道规范》§3.11/§4.3/§5.3。
#
# 签名/公证(阶段2,2026-06-15):--sign source ~/.deskfox-signing/config.env 注入 Developer ID 身份,
#   electron-builder 深签 .app/.dmg(含嵌套 LibreOffice/soffice,修未签名 soffice 被 SIGKILL → office 导出不可用)。
#   --notarize 额外上传 Apple 公证 + staple(慢 5-15min,正式分发用)。都不传 → 未签名快速本地包(行为不变)。
#   密钥全在仓库外 ~/.deskfox-signing/,不入开源仓。详见 docs/features/electron-macos-sign-notarize/。

set -euo pipefail

ENV=""
NO_BUNDLE=0
SIGN=0
NOTARIZE=0
ARCH="arm64"   # 目标 arch,默认本机 Apple Silicon;Intel 交叉编译传 --arch x64(REQ-081)
while [[ $# -gt 0 ]]; do
    case "$1" in
        -Env|--env|-e) ENV="$2"; shift 2 ;;
        --no-bundle|-NoBundle) NO_BUNDLE=1; shift ;;
        --sign|-Sign) SIGN=1; shift ;;
        --notarize|-Notarize) NOTARIZE=1; SIGN=1; shift ;;  # 公证隐含签名
        --arch|-Arch) ARCH="$2"; shift 2 ;;
        *) echo "Unknown arg: $1" >&2; exit 1 ;;
    esac
done

if [[ "$ENV" != "dev" && "$ENV" != "beta" && "$ENV" != "prod" && "$ENV" != "local" ]]; then
    echo "Usage: $0 -Env <dev|beta|prod|local> [--no-bundle] [--arch <arm64|x64>]" >&2
    exit 1
fi

# arch 归一化 + 派生 LO bundle 目录 / electron-builder 产物目录(REQ-081):
#   arm64 → LO macos/、产物 dist-deskfox/mac-arm64/;x64 → LO macos-x64/、产物 dist-deskfox/mac/。
#
# 🔴 产物目录名不是我们定的,是 electron-builder 的规则,别凭直觉写(2026-08-12 修:原先两者写反了):
#   platformPackager.js:  appOutDir = "mac" + getArchSuffix(arch, defaultArch)
#   builder-util/arch.js: getArchSuffix = (arch === defaultArchFromString(defaultArch)) ? "" : "-" + Arch[arch]
#                         defaultArchFromString(undefined) === Arch.x64
#   我们的 electron-builder.deskfox.config.ts 没设 defaultArch → 默认 x64 →
#     x64   得空后缀 → dist-deskfox/mac
#     arm64 得 -arm64 → dist-deskfox/mac-arm64
#   若将来在 config 里显式设了 mac.defaultArch,这里要跟着改(或改用下面 5.5 的按架构探测)。
case "$ARCH" in
    arm64|aarch64) ARCH="arm64"; LO_SUBDIR="macos";     MAC_APP_DIR="mac-arm64" ;;
    x64|x86_64)    ARCH="x64";   LO_SUBDIR="macos-x64"; MAC_APP_DIR="mac" ;;
    *) echo "[deskfox] ❌ --arch 须 arm64|x64(得 $ARCH)" >&2; exit 1 ;;
esac
echo "[deskfox] target arch=$ARCH  (LO bundle: libreoffice-bundle/$LO_SUBDIR)"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRANDING_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$BRANDING_ROOT/../.." && pwd)"
DESKTOP="$REPO_ROOT/packages/desktop"
CONFIG="$DESKTOP/electron-builder.deskfox.config.ts"
VERSIONS_JSON="$BRANDING_ROOT/installer-versions.json"

# === 0.5 跨架构原生预编译就绪(REQ-081,仅 x64 交叉打包)===
# node-pty / @parcel/watcher 走"每平台独立 optional 预编译包"分发(node-pty-darwin-x64 等,各含
#   prebuilds/<plat>/*.node)。bun 在 arm64 主机按包自身 cpu/os 字段【只装 darwin-arm64 那份】。
#   交叉打 x64 包时,electron-builder 磁盘上只有 arm64 的 pty.node → 会把 arm64 原生模块误打进 x64
#   app.asar → Intel 机启动即崩(Error: Cannot find module './prebuilds/darwin-x64/pty.node')。
#   故 x64 build 前用 --cpu='*' 把 darwin 两架构预编译都落到 node_modules(--no-save 不写 lockfile,
#   避免 npmmirror 绝对 URL 污染开源仓);electron-builder 再按 --x64 的 cpu 字段各取所需。
#   arm64 build 本机已有原生预编译,不触发此步 → 现有 arm64/prod 发布流程零改动。
if [[ "$ARCH" == "x64" ]]; then
    echo "[deskfox] 交叉打包 x64:确保 x64 原生预编译(node-pty / parcel-watcher)就位…"
    ( cd "$REPO_ROOT" && env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
        -u ALL_PROXY -u all_proxy bun install --cpu='*' --no-save ) || {
        echo "[deskfox] ❌ x64 原生依赖安装失败(缺 node-pty-darwin-x64 等预编译)" >&2; exit 1; }
    # 硬校验:x64 pty.node 必须真在磁盘上,否则打出来的包必崩,提前失败而非产出坏包
    _PTY_X64="$REPO_ROOT/packages/desktop/node_modules/@lydell/node-pty-darwin-x64/prebuilds/darwin-x64/pty.node"
    if [[ ! -f "$_PTY_X64" ]]; then
        echo "[deskfox] ❌ x64 node-pty 预编译缺失,拒绝产出会崩的 x64 包: $_PTY_X64" >&2; exit 1
    fi
    echo "[deskfox]   x64 原生预编译就位 ✓ ($(file -b "$_PTY_X64"))"
fi

# === 1. 日历版号(prod → macos;dev/beta → <env>-macos,独立号线;local → 回落平台裸号)===
# 实际版本注入由 electron-builder.deskfox.config.ts 自读 installer-versions.json 完成
# (dev-independent-version-line:config 按 --mac/--win argv + channel 选号线)。此处仅预检 + 打印。
VERSION_KEY="macos"
[[ "$ENV" != "prod" ]] && VERSION_KEY="$ENV-macos"
APP_VERSION="$(jq -r --arg k "$VERSION_KEY" '.[$k] // empty' "$VERSIONS_JSON")"
# local 不建独立号线(永不发布、不 bump):local-macos 缺失则回落平台裸号 macos —— config 同样取
# versions[local-macos] ?? versions[macos],两端一致。版本号只作显示牌。详见规范 §3.11。
if [[ -z "$APP_VERSION" && "$ENV" == "local" ]]; then
    VERSION_KEY="macos"
    APP_VERSION="$(jq -r --arg k "$VERSION_KEY" '.[$k] // empty' "$VERSIONS_JSON")"
fi
if [[ -z "$APP_VERSION" ]]; then
    echo "[deskfox] ❌ installer-versions.json 缺 key '$VERSION_KEY'(先跑 bump-installer-version.sh)" >&2
    exit 1
fi
echo "[deskfox] channel=$ENV  version=$APP_VERSION  (key=$VERSION_KEY,实际注入由 deskfox config 自读)"

# === 2. 确保 icon.icns 存在(deskfox config mac.icon 引用;通常已 committed,缺则生成)===
ICON_ENV="dev"; [[ "$ENV" == "prod" ]] && ICON_ENV="prod"
ICNS="$BRANDING_ROOT/src/assets/icons/$ICON_ENV/icon.icns"
if [[ ! -f "$ICNS" ]]; then
    echo "[deskfox] icon.icns 缺失,apply-icons 现场生成 ($ICON_ENV)…"
    bash "$SCRIPT_DIR/apply-icons.sh" -Env "$ICON_ENV" || {
        echo "[deskfox] ❌ icon 生成失败" >&2; exit 1; }
fi

# === 3. 杀运行中的 DeskFox(避免 dist-deskfox 输出目录被运行中的 .app 锁)===
# 只杀「该杀的那几档」,按 .app 路径精确匹配,绝不通杀(对齐 CLAUDE.md 验证约定 / 规范 §3.11):
#   · local 本地版独立身份(ai.deskfox.app.local)+ 数据隔离(opencode-local.db)→ 只杀本地版,
#     绝不碰正在用的正式版/预览版(user 长期开正式版做开发,杀它=打断工作)。
#   · prod 正式版 + dev 预览版 + beta 发布三档共享 opencode.db(server.ts DB 分流 / index.ts 单例锁按 appId 分 →
#     三档互不去重、可同时跑 → 同开一个 SQLite = 锁争用 + session 表写坏,设计上不能共存)→ 三档一起杀,
#     但仍排除 local(隔离无冲突)、不按通用 electron/opencode-cli 名通杀(误伤别的 Electron 应用/别项目 sidecar)。
# 注:".app/Contents/" 锚点精确区分三档 —— "DeskFox.app/" 不匹配 "DeskFox 预览版.app/"/"DeskFox 本地版.app/"(空格/中文隔开)。
if [[ "$ENV" == "local" ]]; then
    pkill -9 -f "DeskFox 本地版.app/Contents/" 2>/dev/null || true
else
    pkill -9 -f "DeskFox.app/Contents/" 2>/dev/null || true       # 正式版(含 Helper)
    pkill -9 -f "DeskFox 预览版.app/Contents/" 2>/dev/null || true # 预览版(含 Helper)
    pkill -9 -f "DeskFox Beta.app/Contents/" 2>/dev/null || true   # Beta(含 Helper,共享 opencode.db)
fi

# === 3.5 打包资源就绪校验(对齐 main build-deskfox.sh §1.9 分层:脚本管"发布物必须有",config 管注入)===
# [feat: electron-replatform-macos] 发布物(非 --no-bundle)= 发布给用户,资源缺了 = 功能在用户机上直接没有。
IS_RELEASE=1; [[ "$NO_BUNDLE" -eq 1 ]] && IS_RELEASE=0
[[ "$ENV" == "local" ]] && IS_RELEASE=0   # 本地测试版永不发布,LO 缺失仅警告不硬卡

# 3.5a plugin dist —— 打包前【从最新源码重建】feishu-bridge / media-gen,再校验。
# 根治"陈旧 dist 静默混入"(2026-06-15 dev-feishu-binding-missing):源码 2026-06-12 把 Bun.serve
#   适配成 node:http(Electron 边车跑 Node 不再是 Bun),但 dist 没人重建仍是旧产物 → 打进包的
#   plugin.js 仍调 Bun.serve → Node 下抛 "Bun is not defined" → 飞书/media-gen 插件 server 起不来
#   → 飞书账号列不出(UI 显示"未绑定")。把"只检查存在"改为"先重建":build-*-plugin.sh 自带时间戳
#   判断,无源码变更则秒跳过,不拖慢迭代;--no-bundle 自测也重建(自测包也含插件,必须新鲜)。
echo "[deskfox] 重建插件 dist(feishu-bridge / media-gen,源码无变更则跳过)…"
bash "$SCRIPT_DIR/build-feishu-plugin.sh"
bash "$SCRIPT_DIR/build-media-gen-plugin.sh"

FEISHU_PLUGIN="$BRANDING_ROOT/plugin/feishu-bridge/dist/plugin.js"
MEDIA_PLUGIN="$REPO_ROOT/packages/media-gen/dist/plugin.js"
for _p in "$FEISHU_PLUGIN" "$MEDIA_PLUGIN"; do
    if [[ ! -f "$_p" ]]; then
        echo "[deskfox] ❌ plugin dist 重建后仍缺失: $_p" >&2
        exit 1
    fi
    # Electron 边车跑 Node:plugin bundle 不得残留 Bun.serve 等 Bun.* 直调(否则插件 server 启动即
    # "Bun is not defined")。源码应已走 node-serve shim(node:http);残留 = 源码没适配/构建目标错。
    if grep -q "Bun\.serve" "$_p"; then
        echo "[deskfox] ❌ plugin dist 仍含 Bun.serve → Node 边车下插件 server 起不来: $_p" >&2
        echo "[deskfox]   确认对应 src 已用 node-serve(node:http)替换 Bun.serve 后重试。" >&2
        exit 1
    fi
done
echo "[deskfox] plugin dist 就绪且无 Bun.serve 残留 ✓"

# 3.5b LibreOffice bundle —— office 预览/转换依赖。
# 实测(2026-06-14 mac 全新 profile 冷启动转换):presets/ 是【硬依赖】—— 删之后 office 转换直接失败
#   (profile 虽建成但 convert 无输出);extensions/ 在 LO bundle 里通常是【空目录】,electron-builder
#   打包必丢弃空目录(实测最终 .app 无 extensions),但缺它冷启动转换完全正常 → 不作硬门槛,仅作完整性提示。
# 故此处只硬卡 presets 非空;extensions 仅警告。最终包是否真含 presets 由 §5.5 post-build 复验(堵打包漏拷)。
LO_BUNDLE_APP="$BRANDING_ROOT/libreoffice-bundle/$LO_SUBDIR/LibreOffice.app"
if [[ -d "$LO_BUNDLE_APP" ]]; then
    LO_RES="$LO_BUNDLE_APP/Contents/Resources"
    if [[ ! -d "$LO_RES/presets" ]] || [[ -z "$(ls -A "$LO_RES/presets" 2>/dev/null)" ]]; then
        echo "[deskfox] ❌ LO bundle 缺 Contents/Resources/presets(或为空)— office 转换硬依赖,打包必致干净机器功能失效。" >&2
        echo "[deskfox]   重跑 prepare-lo-bundle.sh 重做 bundle(内置冷启动 smoke 闸,保证产出健康 bundle)。" >&2
        exit 1
    fi
    [[ -d "$LO_RES/extensions" ]] || echo "[deskfox] ⚠️  LO bundle 无 Contents/Resources/extensions(LO 习惯空目录,缺之冷启动转换实测无害,仅提示)" >&2
    LO_SIZE=$(du -sm "$LO_BUNDLE_APP" 2>/dev/null | awk '{print $1}')
    echo "[deskfox] LO bundle 健康(${LO_SIZE}MB,presets 非空)→ deskfox config 注入 Contents/Resources/libreoffice"
elif [[ "$IS_RELEASE" -eq 1 ]]; then
    echo "[deskfox] ❌ 发布物构建但 LO bundle 不存在: $LO_BUNDLE_APP" >&2
    echo "[deskfox]   绝不静默出不含 LibreOffice 的发布包(office 预览/导出会失效)。先跑 prepare-lo-bundle.sh 做健康 bundle。" >&2
    echo "[deskfox]   (仅本机 .app 自测可加 --no-bundle 跳过 LO)" >&2
    exit 1
else
    echo "[deskfox] ⚠️  LO bundle 不存在(--no-bundle 自测放行,本机 office 功能不可用): $LO_BUNDLE_APP" >&2
fi

# === 4. electron-vite build(自动跑 predev:编译 opencode Node 后端 + copy-icons)===
export OPENCODE_CHANNEL="$ENV"
# REQ-081:把【目标 arch】透传给 electron.vite.config.ts,让 node-pty-narrower 插件按目标架构(而非
#   构建机 process.arch)选并 externalize node-pty 子包。交叉打 x64 的成败关键 —— 否则 arm64 机产出的
#   x64 bundle 会写死 import arm64 子包 → Intel 启动即崩(prebuilds/darwin-x64/pty.node not found)。
export DESKFOX_TARGET_ARCH="$ARCH"
export ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"
export ELECTRON_BUILDER_BINARIES_MIRROR="${ELECTRON_BUILDER_BINARIES_MIRROR:-https://npmmirror.com/mirrors/electron-builder-binaries/}"
# electron 下载缓存:本机外置卷优先(内置盘空间紧),无则回落 electron-builder 系统默认。
# 不硬编码 /Volumes/ExtSSD(开源仓:他机无此卷会 mkdir 失败 break 构建)。
if [[ -z "${ELECTRON_CACHE:-}" && -d /Volumes/ExtSSD ]]; then
    export ELECTRON_CACHE="/Volumes/ExtSSD/.cache/electron"
fi
[[ -n "${ELECTRON_CACHE:-}" ]] && mkdir -p "$ELECTRON_CACHE"

echo "[deskfox] electron-vite build…"
( cd "$DESKTOP" && bun run build )

# === 4.6 签名/公证 env 注入(--sign / --notarize;密钥全在仓库外 ~/.deskfox-signing)===
# config.deskfox.ts 的 mac.identity / mac.notarize 是 env 驱动:这里 source 后 electron-builder 自动深签+公证。
if [[ "$SIGN" -eq 1 ]]; then
    SIGN_ENV="$HOME/.deskfox-signing/config.env"
    [[ -f "$SIGN_ENV" ]] || { echo "[deskfox] ❌ --sign 需要 $SIGN_ENV(签名身份+公证凭据,仓库外私密)" >&2; exit 1; }
    # shellcheck disable=SC1090
    source "$SIGN_ENV"
    [[ -n "${APPLE_SIGNING_IDENTITY:-}" ]] || { echo "[deskfox] ❌ config.env 未提供 APPLE_SIGNING_IDENTITY" >&2; exit 1; }
    export APPLE_SIGNING_IDENTITY
    echo "[deskfox] 🔏 签名身份已加载(Developer ID)"
    if [[ "$NOTARIZE" -eq 1 ]]; then
        # @electron/notarize 走 App Store Connect API key:映射 DESKFOX_NOTARY_* → APPLE_API_*
        export APPLE_API_KEY="${DESKFOX_NOTARY_KEY:?config.env 缺 DESKFOX_NOTARY_KEY}"
        export APPLE_API_KEY_ID="${DESKFOX_NOTARY_KEY_ID:?config.env 缺 DESKFOX_NOTARY_KEY_ID}"
        export APPLE_API_ISSUER="${DESKFOX_NOTARY_ISSUER:?config.env 缺 DESKFOX_NOTARY_ISSUER}"
        export DESKFOX_NOTARIZE=1
        echo "[deskfox] 📜 公证已启用(App Store Connect API key;上传 Apple notary,5-15min)"
    fi

    # 预签嵌套 LibreOffice.app:electron-builder 的 osx-sign 逐文件签搞不定 LO 多可执行结构
    # (soffice 主可执行需兄弟 uno 先签,顺序无保证 → "subcomponent not signed" 失败)。
    # codesign --deep 正确按由内到外签整个 bundle;config 的 mac.signIgnore 让 electron-builder 跳过 LO,
    # 故必须这里先把【源】LO 签好(electron-builder extraResources 拷贝保留签名,外层 seal 覆盖之)。
    LO_SRC="$BRANDING_ROOT/libreoffice-bundle/$LO_SUBDIR/LibreOffice.app"
    if [[ -d "$LO_SRC" ]]; then
        TS_ARG="--timestamp=none"                       # dev 签名免时间戳(快);公证才需安全时间戳
        [[ "$NOTARIZE" -eq 1 ]] && TS_ARG="--timestamp"
        echo "[deskfox] 🔏 预签 LibreOffice.app(codesign --deep ${TS_ARG};首次/重签约 4min,带时间戳约 28min)…"
        codesign --deep --force --options runtime \
            --entitlements "$DESKTOP/resources/entitlements.plist" $TS_ARG \
            --sign "$APPLE_SIGNING_IDENTITY" "$LO_SRC"
        codesign --verify --deep --strict "$LO_SRC" \
            || { echo "[deskfox] ❌ LibreOffice 预签校验失败" >&2; exit 1; }
        echo "[deskfox]   LibreOffice 预签 + 校验通过 ✓"
    else
        echo "[deskfox] ⚠️  未找到 $LO_SRC,跳过 LO 预签(office 转换将不可用)" >&2
    fi
fi

# === 5. electron-builder 打包(--publish never;--no-bundle → --dir 只出 .app)===
EB_ARGS=(--mac "--$ARCH" --publish never --config electron-builder.deskfox.config.ts)
# local 永不发布 → 始终 --dir(只出 .app,不打 dmg/installer);--no-bundle 同样 --dir。
if [[ "$NO_BUNDLE" -eq 1 || "$ENV" == "local" ]]; then EB_ARGS=(--dir "${EB_ARGS[@]}"); fi

echo "[deskfox] electron-builder ${EB_ARGS[*]}…"
(
    cd "$DESKTOP"
    if [[ "$NOTARIZE" -eq 1 ]]; then
        # 公证须够到 Apple notary(Tauri 时代经代理可达):保留代理,仅把 npmmirror 加 NO_PROXY 走直连,
        # 避免「全量绕代理」把 Apple 也断了。
        export NO_PROXY="${NO_PROXY:-},npmmirror.com,.npmmirror.com" no_proxy="${no_proxy:-},npmmirror.com,.npmmirror.com"
        ./node_modules/.bin/electron-builder "${EB_ARGS[@]}"
    else
        # 不公证:沿用全量绕 Clash 代理(npmmirror 直连,避 electron checksum 经国外节点超时)。
        # 签名 env(APPLE_SIGNING_IDENTITY)经 export 已被子环境继承,env -u 只摘代理变量不影响签名。
        env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u ALL_PROXY -u all_proxy \
            ./node_modules/.bin/electron-builder "${EB_ARGS[@]}"
    fi
)

# === 5.5 post-build 验证:最终 .app 真含可执行 soffice(挡"LO 没被 electron-builder 收进最终包")===
# [feat: electron-replatform-macos] 对齐 main §2.4。LO 源健康但仍可能因 config/打包意外没注入 .app。
# 注:此处 soffice 尚未 Developer ID 签名 —— 嵌套 bundle 签名是阶段2(当前 config identity=null 出未签名包),
#     故只做结构性存在检查;冷启动健康由 prepare-lo-bundle 的 smoke 闸已保证。
#
# 🔴 定位 + 架构断言(2026-08-12 重写,起因见下)。原实现只 `ls $MAC_APP_DIR/*.app`,而 MAC_APP_DIR
#   当时写反了,后果是双向的:
#     x64  → mac-x64/ 不存在 → ls 失败 → set -euo pipefail 静默终止整个脚本(EXIT=1,且本段一行不打印)
#     arm64→ 落到 mac/,恰好是上一次 x64 构建的残留包 → **验的不是本次产物,却报绿**(假绿更危险)
#   现在:仍只认规范目录 $MAC_APP_DIR(不做模糊扫描 —— dist-deskfox 下会有 mac-arm64-restored/ 这类
#   人工残留目录,且 glob 排序里 '-'(0x2D) < '/'(0x2F) 会让 mac-arm64-restored/ 排在 mac-arm64/ 前面,
#   扫描反而更容易撞上陈旧包),但**强制断言主可执行架构 == 本次目标架构**,把"验错对象"变成硬失败。
#   ⚠️ lipo 的架构名与 electron-builder 不同:x64 → x86_64;arm64 → arm64。别直接拿 $ARCH 比。
if [[ -d "$LO_BUNDLE_APP" ]]; then
    case "$ARCH" in
        x64)   LIPO_ARCH="x86_64" ;;
        arm64) LIPO_ARCH="arm64" ;;
    esac
    APP_DIR_ABS="$DESKTOP/dist-deskfox/$MAC_APP_DIR"
    APP_PATH="$(ls -d "$APP_DIR_ABS"/*.app 2>/dev/null | head -1 || true)"
    if [[ -z "$APP_PATH" ]]; then
        echo "[deskfox] ❌ post-build verify: 规范产物目录下没有 .app: $APP_DIR_ABS" >&2
        echo "[deskfox]   若 electron-builder 改了产物目录命名规则,同步更新本脚本顶部的 MAC_APP_DIR 映射。" >&2
        exit 1
    fi
    APP_EXE="$APP_PATH/Contents/MacOS/$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP_PATH/Contents/Info.plist" 2>/dev/null)"
    APP_ARCHS="$(lipo -archs "$APP_EXE" 2>/dev/null || echo '')"
    if ! echo "$APP_ARCHS" | tr ' ' '\n' | grep -qx "$LIPO_ARCH"; then
        echo "[deskfox] ❌ post-build verify: 产物架构与目标不符 — 很可能验到了上次构建的残留包" >&2
        echo "[deskfox]   目录=$APP_DIR_ABS  期望=$LIPO_ARCH  实得=${APP_ARCHS:-(读不到)}" >&2
        exit 1
    fi
    echo "[deskfox] post-build verify: 目标 .app = $APP_PATH (主可执行 $LIPO_ARCH ✓)"
    # LO 架构必须与主程序一致 —— x64 包里塞 arm64 的 soffice 会让 Intel 用户 office 转换直接失败。
    VERIFY_LO_EXE="$APP_PATH/Contents/Resources/libreoffice/Contents/MacOS/soffice"
    if [[ -x "$VERIFY_LO_EXE" ]] && ! lipo -archs "$VERIFY_LO_EXE" 2>/dev/null | tr ' ' '\n' | grep -qx "$LIPO_ARCH"; then
        echo "[deskfox] ❌ post-build verify: 内置 LibreOffice 架构与目标不符" >&2
        echo "[deskfox]   期望 $LIPO_ARCH,实得 $(lipo -archs "$VERIFY_LO_EXE" 2>/dev/null)。LO bundle 源目录(macos / macos-x64)可能选错。" >&2
        exit 1
    fi
    if [[ -n "$APP_PATH" ]]; then
        LO_DST="$APP_PATH/Contents/Resources/libreoffice"
        VERIFY_SOFFICE="$LO_DST/Contents/MacOS/soffice"
        if [[ ! -x "$VERIFY_SOFFICE" ]]; then
            echo "[deskfox] ❌ 打包后最终 .app 内未找到可执行 soffice: $VERIFY_SOFFICE" >&2
            echo "[deskfox]   LO 源健康但没注入最终包(疑 extraResources/打包问题)。绝不发布不含 LibreOffice 的包。" >&2
            exit 1
        fi
        # presets 是 office 转换硬依赖(实测删之转换失败)。源健康 ≠ 进了最终包 —— electron-builder 可能漏拷,
        # 必须复验进了最终包,否则 office 功能在用户机静默失效。(空目录 extensions 打包必丢且无害,不验。)
        VERIFY_PRESETS="$LO_DST/Contents/Resources/presets"
        if [[ ! -d "$VERIFY_PRESETS" ]] || [[ -z "$(ls -A "$VERIFY_PRESETS" 2>/dev/null)" ]]; then
            echo "[deskfox] ❌ 打包后最终 .app 内 LO presets 缺失/为空: $VERIFY_PRESETS" >&2
            echo "[deskfox]   presets 是 office 转换硬依赖,源健康但没进最终包 → office 功能在用户机静默失效。" >&2
            exit 1
        fi
        echo "[deskfox] post-build verify: 最终 .app 含可执行 soffice($ARCH)+ 非空 presets ✓"
    fi
fi

# === 6. 产物路径 ===
OUT="$DESKTOP/dist-deskfox"
echo ""
echo "[deskfox] ✅ 构建完成,产物:"
if [[ "$NO_BUNDLE" -eq 1 || "$ENV" == "local" ]]; then
    ls -d "$OUT/$MAC_APP_DIR"/*.app 2>/dev/null | while read -r a; do echo "  .app : $a"; done
else
    ls "$OUT"/*-"$ARCH".dmg "$OUT"/*-"$ARCH".zip 2>/dev/null | while read -r f; do echo "  $f"; done
    ls -d "$OUT/$MAC_APP_DIR"/*.app 2>/dev/null | while read -r a; do echo "  .app : $a"; done
fi
