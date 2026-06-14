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
#   bash packages/branding/scripts/build-deskfox-electron.sh -Env dev               # 完整出 dmg+zip+app
#   bash packages/branding/scripts/build-deskfox-electron.sh -Env dev --no-bundle   # 只出 .app(最快,本地测)
#   bash packages/branding/scripts/build-deskfox-electron.sh -Env prod
#
# 注:本脚本阶段1只产【未签名】包(deskfox config mac.identity=null)。签名+公证是阶段2,另接。

set -euo pipefail

ENV=""
NO_BUNDLE=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        -Env|--env|-e) ENV="$2"; shift 2 ;;
        --no-bundle|-NoBundle) NO_BUNDLE=1; shift ;;
        *) echo "Unknown arg: $1" >&2; exit 1 ;;
    esac
done

if [[ "$ENV" != "dev" && "$ENV" != "beta" && "$ENV" != "prod" ]]; then
    echo "Usage: $0 -Env <dev|beta|prod> [--no-bundle]" >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRANDING_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$BRANDING_ROOT/../.." && pwd)"
DESKTOP="$REPO_ROOT/packages/desktop"
CONFIG="$DESKTOP/electron-builder.deskfox.config.ts"
VERSIONS_JSON="$BRANDING_ROOT/installer-versions.json"

# === 1. 日历版号(prod → macos;dev/beta → <env>-macos,独立号线)===
# 实际版本注入由 electron-builder.deskfox.config.ts 自读 installer-versions.json 完成
# (dev-independent-version-line:config 按 --mac/--win argv + channel 选号线)。此处仅预检 + 打印。
VERSION_KEY="macos"
[[ "$ENV" != "prod" ]] && VERSION_KEY="$ENV-macos"
APP_VERSION="$(jq -r --arg k "$VERSION_KEY" '.[$k] // empty' "$VERSIONS_JSON")"
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
pkill -9 -f "DeskFox" 2>/dev/null || true

# === 4. electron-vite build(自动跑 predev:编译 opencode Node 后端 + copy-icons)===
export OPENCODE_CHANNEL="$ENV"
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

# === 5. electron-builder 打包(绕代理 + --publish never;--no-bundle → --dir 只出 .app)===
EB_ARGS=(--mac --publish never --config electron-builder.deskfox.config.ts)
[[ "$NO_BUNDLE" -eq 1 ]] && EB_ARGS=(--dir "${EB_ARGS[@]}")

echo "[deskfox] electron-builder ${EB_ARGS[*]}  (绕 Clash 代理直连 npmmirror)…"
(
    cd "$DESKTOP"
    env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u ALL_PROXY -u all_proxy \
        ./node_modules/.bin/electron-builder "${EB_ARGS[@]}"
)

# === 6. 产物路径 ===
OUT="$DESKTOP/dist-deskfox"
echo ""
echo "[deskfox] ✅ 构建完成,产物:"
if [[ "$NO_BUNDLE" -eq 1 ]]; then
    ls -d "$OUT"/mac*/*.app 2>/dev/null | while read -r a; do echo "  .app : $a"; done
else
    ls "$OUT"/*.dmg "$OUT"/*.zip 2>/dev/null | while read -r f; do echo "  $f"; done
    ls -d "$OUT"/mac*/*.app 2>/dev/null | while read -r a; do echo "  .app : $a"; done
fi
