#!/usr/bin/env bash
# [fork-only] DeskFox PNG → .icns 转换器(macOS only,用 iconutil)
#
# .icns 是 macOS 原生 icon 格式。iconutil 是 macOS 内置工具(无需 brew)。
# 标准 iconset 命名规范:
#   icon_16x16.png       icon_16x16@2x.png      → 32x32
#   icon_32x32.png       icon_32x32@2x.png      → 64x64
#   icon_128x128.png     icon_128x128@2x.png    → 256x256
#   icon_256x256.png     icon_256x256@2x.png    → 512x512
#   icon_512x512.png     icon_512x512@2x.png    → 1024x1024
#
# 输入:ico-source/<size>.png(我们仓现有命名约定,size = 16/32/64/128/256/512/1024)
# 输出:<env>/icon.icns
#
# 用法:bash png-to-icns.sh <out.icns> <ico-source-dir>

set -e

OUT_ICNS="$1"
SRC_DIR="$2"

if [[ -z "$OUT_ICNS" || -z "$SRC_DIR" ]]; then
    echo "Usage: $0 <out.icns> <ico-source-dir>" >&2
    exit 1
fi

if [[ ! -d "$SRC_DIR" ]]; then
    echo "Error: source dir '$SRC_DIR' not found" >&2
    exit 1
fi

if ! command -v iconutil >/dev/null 2>&1; then
    echo "Error: iconutil not found — this script must run on macOS" >&2
    exit 1
fi

ICONSET_DIR=$(mktemp -d)/icon.iconset
mkdir -p "$ICONSET_DIR"
trap "rm -rf $(dirname "$ICONSET_DIR")" EXIT

# 按 iconset 命名规范从 ico-source/ 拷文件;source 缺哪档就跳过哪档
# (.icns 不要求所有档齐全,缺档系统会从最近大档缩;但常用档建议齐全)
# FORK: 记下缺档,收尾时显式报出来 —— 原实现静默跳过,导致 dev 档少了 512/1024 两个源图
#   却一路无声:icns 封顶 128×128(8.5KB,prod 是 1024×1024/138KB),Retina 上图标被放大拉糊,
#   直到 2026-08-18 user 肉眼发现才暴露。静默降级是最难查的一类问题,这里把它变成看得见的。
#   [feat: dev-channel-icon-lowres] 2026-08-18
MISSING_SIZES=()
copy_if_exists() {
    local src="$SRC_DIR/$1"
    local dst="$ICONSET_DIR/$2"
    if [[ -f "$src" ]]; then
        cp "$src" "$dst"
    else
        MISSING_SIZES+=("$1")
    fi
}

copy_if_exists "16.png"   "icon_16x16.png"
copy_if_exists "32.png"   "icon_16x16@2x.png"
copy_if_exists "32.png"   "icon_32x32.png"
copy_if_exists "64.png"   "icon_32x32@2x.png"
copy_if_exists "128.png"  "icon_128x128.png"
copy_if_exists "256.png"  "icon_128x128@2x.png"
copy_if_exists "256.png"  "icon_256x256.png"
copy_if_exists "512.png"  "icon_256x256@2x.png"
copy_if_exists "512.png"  "icon_512x512.png"
copy_if_exists "1024.png" "icon_512x512@2x.png"

# 验证至少有一档
if [[ -z "$(ls -A "$ICONSET_DIR")" ]]; then
    echo "Error: no PNG copied — source dir empty or naming wrong (expected 16.png/32.png/...)" >&2
    exit 1
fi

# FORK: 缺档显式报警(尤其 512/1024 —— 少了它们 Retina 图标必糊)
if [[ ${#MISSING_SIZES[@]} -gt 0 ]]; then
    UNIQUE_MISSING=$(printf '%s\n' "${MISSING_SIZES[@]}" | sort -u | tr '\n' ' ')
    echo "⚠️  ico-source 缺档: ${UNIQUE_MISSING}(源目录 $SRC_DIR)" >&2
    if printf '%s\n' "${MISSING_SIZES[@]}" | grep -qE '^(512|1024)\.png$'; then
        echo "⚠️  缺 512/1024 → 生成的 .icns 分辨率封顶,Retina 上图标会被放大拉糊。" >&2
        echo "    修法:补齐源图后重跑;dev 档可用 bun packages/branding/scripts/gen-dev-icons.mjs 从矢量源重生成。" >&2
    fi
fi

iconutil -c icns "$ICONSET_DIR" -o "$OUT_ICNS"

# iconutil 自带验证,失败会非 0 退出
echo "wrote $OUT_ICNS ($(stat -f%z "$OUT_ICNS" 2>/dev/null || stat -c%s "$OUT_ICNS") bytes)"
