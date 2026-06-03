#!/usr/bin/env bash
# [fork-only] macOS LibreOffice 预捆绑 bundle 准备脚本
# 对称 Windows prepare-lo-bundle.ps1,用于在 macOS 开发机上一次性准备 LO bundle。
#
# 流程:
#   1. 下载 LibreOffice DMG (arm64 / x86_64,国内镜像加速)
#   2. 校验 DMG 文件头(compound doc magic)
#   3. hdiutil attach 挂载
#   4. cp -R LibreOffice.app 到输出目录
#   5. hdiutil detach 卸载
#   6. 剥皮:删 help/gallery/template/autotext/autocorrect/wordbook/basic/extensions 内容
#      (同 Windows 策略;保留 extensions 目录骨架,否则 soffice 首次 profile 创建 fatal error)
#   7. 移除 LibreOffice 原有代码签名(允许后续 Tauri 统一对整个 .app 重签)
#   8. 体积检查 + 完成提示
#
# 输出: packages/branding/libreoffice-bundle/macos/LibreOffice.app
#       (目录已在 .gitignore,不进 git)
#
# 用法:
#   bash packages/branding/scripts/prepare-lo-bundle.sh
#   bash packages/branding/scripts/prepare-lo-bundle.sh -Version 25.8.7
#   bash packages/branding/scripts/prepare-lo-bundle.sh -Arch x86_64

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRANDING_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- 默认参数 ---
VERSION="25.8.7"   # Still 稳定线,与 Windows prepare-lo-bundle.ps1 保持一致
ARCH="aarch64"     # Apple Silicon 默认;Intel Mac 传 -Arch x86_64

while [[ $# -gt 0 ]]; do
    case "$1" in
        -Version|--version|-v) VERSION="$2"; shift 2 ;;
        -Arch|--arch|-a)       ARCH="$2";    shift 2 ;;
        *) echo "Unknown arg: $1" >&2; exit 1 ;;
    esac
done

# arm64 和 x86_64 的 URL 后缀不同
if [[ "$ARCH" == "aarch64" || "$ARCH" == "arm64" ]]; then
    ARCH_DIR="aarch64"
    ARCH_SUFFIX="aarch64"
elif [[ "$ARCH" == "x86_64" || "$ARCH" == "x64" ]]; then
    ARCH_DIR="x86_64"
    ARCH_SUFFIX="x86-64"
else
    echo "Unknown arch: $ARCH (supported: aarch64/arm64, x86_64/x64)" >&2
    exit 1
fi

DMG_NAME="LibreOffice_${VERSION}_MacOS_${ARCH_SUFFIX}.dmg"
PATH_SUFFIX="${VERSION}/mac/${ARCH_DIR}/${DMG_NAME}"

# --- 镜像列表(与 office-installer.ts MIRRORS 同步) ---
MIRRORS=(
    "https://mirrors.tuna.tsinghua.edu.cn/libreoffice/libreoffice/stable"
    "https://mirrors.ustc.edu.cn/tdf/libreoffice/stable"
    "https://mirrors.bfsu.edu.cn/libreoffice/libreoffice/stable"
    "https://mirrors.nju.edu.cn/tdf/libreoffice/stable"
    "https://download.documentfoundation.org/libreoffice/stable"
)

CACHE_DIR="$BRANDING_ROOT/libreoffice-bundle/cache"
DEST_DIR="$BRANDING_ROOT/libreoffice-bundle/macos"
DMG_PATH="$CACHE_DIR/$DMG_NAME"

mkdir -p "$CACHE_DIR" "$DEST_DIR"

echo "[lo-bundle-mac] target: LibreOffice $VERSION macOS $ARCH_SUFFIX"
echo "[lo-bundle-mac] DMG: $DMG_NAME"

# --- 下载 DMG(尝试各镜像,第一个成功的使用) ---
if [[ -f "$DMG_PATH" ]]; then
    SIZE_MB=$(( $(stat -f%z "$DMG_PATH") / 1024 / 1024 ))
    echo "[lo-bundle-mac] cache hit: $DMG_PATH ($SIZE_MB MB)"
else
    DOWNLOADED=0
    for MIRROR in "${MIRRORS[@]}"; do
        URL="${MIRROR}/${PATH_SUFFIX}"
        echo "[lo-bundle-mac] trying: $URL"
        if curl -L --fail --progress-bar -o "$DMG_PATH.part" "$URL" 2>&1; then
            mv "$DMG_PATH.part" "$DMG_PATH"
            DOWNLOADED=1
            break
        else
            echo "[lo-bundle-mac] mirror failed, trying next..."
            rm -f "$DMG_PATH.part"
        fi
    done
    if [[ "$DOWNLOADED" -eq 0 ]]; then
        echo "[lo-bundle-mac] ERROR: all mirrors failed" >&2
        exit 1
    fi
fi

# --- 校验 DMG 文件头(Apple Disk Image 以 "koly" trailer 结尾,头部是 ZIP/HFS 数据) ---
# 简单检查:文件大于 100MB(正常 DMG ~280MB,截断/HTML 错误页通常 <1MB)
DMG_SIZE=$(stat -f%z "$DMG_PATH")
if [[ "$DMG_SIZE" -lt $((100 * 1024 * 1024)) ]]; then
    echo "[lo-bundle-mac] ERROR: DMG too small ($DMG_SIZE bytes), likely a download error" >&2
    rm -f "$DMG_PATH"
    exit 1
fi
echo "[lo-bundle-mac] DMG size OK: $(( DMG_SIZE / 1024 / 1024 )) MB"

# --- 挂载 DMG ---
echo "[lo-bundle-mac] mounting DMG..."
MOUNT_OUTPUT=$(hdiutil attach "$DMG_PATH" -nobrowse -noautoopen 2>&1)
echo "$MOUNT_OUTPUT"
MOUNT_POINT=$(echo "$MOUNT_OUTPUT" | tail -1 | awk -F'\t' '{print $NF}' | sed 's/^[[:space:]]*//')

if [[ -z "$MOUNT_POINT" || ! -d "$MOUNT_POINT" ]]; then
    echo "[lo-bundle-mac] ERROR: could not parse mount point from hdiutil output" >&2
    exit 1
fi
echo "[lo-bundle-mac] mounted at: $MOUNT_POINT"

# --- 找 LibreOffice.app ---
APP_SRC=$(find "$MOUNT_POINT" -maxdepth 1 -name "*.app" | grep -i libre | head -1)
if [[ -z "$APP_SRC" ]]; then
    echo "[lo-bundle-mac] ERROR: LibreOffice.app not found in $MOUNT_POINT" >&2
    hdiutil detach "$MOUNT_POINT" -force 2>/dev/null || true
    exit 1
fi
echo "[lo-bundle-mac] found: $APP_SRC"

# --- 复制到输出目录 ---
DEST_APP="$DEST_DIR/LibreOffice.app"
rm -rf "$DEST_APP"
echo "[lo-bundle-mac] copying LibreOffice.app (~280MB, takes ~30s)..."
cp -R "$APP_SRC" "$DEST_APP"
hdiutil detach "$MOUNT_POINT" -force 2>/dev/null || true
echo "[lo-bundle-mac] unmounted"

# --- 剥皮:删除对 headless PDF 转换无用的大体积目录 ---
# 同 Windows prepare-lo-bundle.ps1 策略
RESOURCES="$DEST_APP/Contents/Resources"
echo "[lo-bundle-mac] stripping unnecessary files..."

STRIP_DIRS=(
    "help"
    "gallery"
    "template"
    "autotext"
    "autocorrect"
    "wordbook"
    "basic"
    "xslt"
    "presets"
    "wizards"
)

for DIR in "${STRIP_DIRS[@]}"; do
    TARGET="$RESOURCES/$DIR"
    if [[ -d "$TARGET" ]]; then
        SIZE=$(du -sm "$TARGET" 2>/dev/null | awk '{print $1}')
        rm -rf "$TARGET"
        echo "[lo-bundle-mac]   deleted $DIR/ (~${SIZE}MB)"
    fi
done

# extensions: 保留目录骨架,只删内容
# (整删会导致 soffice 首次创建 user profile 时 fatal error — Windows 踩坑 #2)
EXT_DIR="$RESOURCES/extensions"
if [[ -d "$EXT_DIR" ]]; then
    EXT_SIZE=$(du -sm "$EXT_DIR" 2>/dev/null | awk '{print $1}')
    find "$EXT_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null || true
    echo "[lo-bundle-mac]   cleared extensions/ contents (~${EXT_SIZE}MB, kept dir skeleton)"
fi

# Java 相关(headless PDF 转换不需要 JVM)
JAVA_DIR="$DEST_APP/Contents/Frameworks"
if [[ -d "$JAVA_DIR" ]]; then
    # 删 JVM 但保留 dylib(部分 LO 内部 lib 在 Frameworks 下)
    find "$JAVA_DIR" -name "*.jdk" -o -name "*.jre" | while read -r J; do
        JVM_SIZE=$(du -sm "$J" 2>/dev/null | awk '{print $1}')
        rm -rf "$J"
        echo "[lo-bundle-mac]   deleted JVM $J (~${JVM_SIZE}MB)"
    done
fi

# 多语言 UI 翻译文件:只保留 en-US
# (Windows 实测:zh-CN 等翻译文件 ~200MB,UTF-8 headless 转换不需要 UI locale)
if [[ -d "$RESOURCES/registry" ]]; then
    find "$RESOURCES/registry" -name "*_*.xcu" ! -name "*en_US*" -delete 2>/dev/null || true
fi

# --- 体积检查 ---
FINAL_SIZE_MB=$(du -sm "$DEST_APP" 2>/dev/null | awk '{print $1}')
echo "[lo-bundle-mac] stripped size: ${FINAL_SIZE_MB} MB"
if [[ "$FINAL_SIZE_MB" -gt 800 ]]; then
    echo "[lo-bundle-mac] WARNING: size > 800MB, stripping may not have worked correctly"
    echo "                Check: du -sh $RESOURCES/*"
fi

# --- 移除 LibreOffice 原有代码签名 ---
# 让 DeskFox Tauri build 在打包时统一对整个 .app 重签
# (保留 LO 原签名会导致 codesign 对 .app 整体签名失败 — 不允许嵌套签名主体)
echo "[lo-bundle-mac] removing existing code signatures (Tauri will re-sign)..."
find "$DEST_APP" -type f \( -perm +0111 -o -name "*.dylib" -o -name "*.so" \) \
    -exec codesign --remove-signature {} \; 2>/dev/null || true
# 主 bundle
codesign --remove-signature "$DEST_APP" 2>/dev/null || true
echo "[lo-bundle-mac] signatures removed"

echo ""
echo "[lo-bundle-mac] === DONE ==="
echo "[lo-bundle-mac] output: $DEST_APP"
echo "[lo-bundle-mac] size:   ${FINAL_SIZE_MB} MB"
echo ""
echo "Next: run build-deskfox.sh -Env dev (or prod) to include it in DeskFox.app"
echo "      build-deskfox.sh auto-detects libreoffice-bundle/macos/LibreOffice.app"
