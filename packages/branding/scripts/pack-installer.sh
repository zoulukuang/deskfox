#!/usr/bin/env bash
# [fork-only] DeskFox one-shot installer pipeline (macOS)
#
# 发布渠道与版本号规则完整 doc:docs/governance/版本号与发布渠道规范.md
#   - Tier 1 稳定版(prod 无后缀,GitHub Release latest)
#   - Tier 2 预览版(dev `-dev` 后缀,GitHub Release prerelease)
#   - Tier 3 本地测试版(`build-deskfox.sh -Env dev --no-bundle` 出 raw .app,不 ship,不走本脚本)
#
# Workflow:
#   1. bump-installer-version.sh  -> bump version + write placeholder to docs/installer-versions.md
#   2. build-deskfox.sh -Env prod -> build .app + .dmg via tauri
#   3. Print artifact paths
#
# Prereq:
#   - Xcode Command Line Tools installed (for hdiutil, codesign etc.)
#   - Rust + Bun toolchain ready
#
# Usage:
#   bash packages/branding/scripts/pack-installer.sh
#   bash packages/branding/scripts/pack-installer.sh --env beta
#   bash packages/branding/scripts/pack-installer.sh --no-bump   # skip version bump (re-pack only)

set -e

ENV="prod"
NO_BUMP=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        -Env|--env|-e)
            ENV="$2"
            shift 2
            ;;
        --no-bump)
            NO_BUMP=1
            shift
            ;;
        *)
            echo "Unknown arg: $1" >&2
            exit 1
            ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRANDING_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$BRANDING_ROOT/../.." && pwd)"

# === 发布闸:Tier1/2 发布物必须含 LibreOffice(权威把关)===
# [feat: lo-bundle-coldstart-smoke-gate 2026-06-08] pack-installer 是发布唯一入口(Tier3 本地测试
# 走 build-deskfox --no-bundle,不走本脚本),故在此权威把关 —— 与 build-deskfox 的 --no-bundle 判据
# 无关(Windows 发布也用 -NoBundle,那个判据在 Win 不可靠;走没走 pack-installer 才是"是否发布"的真判据)。
# LO bundle 源缺失/不完整 → 在 bump 版本号前就硬失败,绝不出不含 LO 的发布包,也不浪费版本号。
LO_BUNDLE_APP="$BRANDING_ROOT/libreoffice-bundle/macos/LibreOffice.app"
if [[ ! -d "$LO_BUNDLE_APP" ]]; then
    echo "[pack] ERROR: 发布(Tier1/2)必须含 LibreOffice,但 bundle 不存在: $LO_BUNDLE_APP" >&2
    echo "[pack]   先跑 prepare-lo-bundle.sh 做出健康 bundle(内置冷启动 smoke 闸)再发布。" >&2
    echo "[pack]   (仅本机 raw exe 自测用 build-deskfox.sh --no-bundle,不走本脚本)" >&2
    exit 1
fi
for _req in presets extensions; do
    if [[ ! -d "$LO_BUNDLE_APP/Contents/Resources/$_req" ]]; then
        echo "[pack] ERROR: LO bundle 缺 Contents/Resources/$_req(过期/过度剥皮)— 重跑 prepare-lo-bundle.sh 重做" >&2
        exit 1
    fi
done
echo "[pack] 发布闸: LO bundle 就位(含 presets + extensions)✓"

# 1. Bump version
NEW_VERSION=""
if [[ "$NO_BUMP" -eq 0 ]]; then
    echo "=== Step 1: bump version ==="
    # FORK: 透传 env 给 bump 脚本 — dev/beta 出带 suffix 版本号(例 2026.5.21.1-dev)
    # [feat: installer-version-env-suffix] 2026-05-21
    BUMP_OUT=$("$SCRIPT_DIR/bump-installer-version.sh" -Platform macOS --env "$ENV")
    echo "$BUMP_OUT"
    VERSION_LINE=$(echo "$BUMP_OUT" | grep '^VERSION=' | head -1)
    if [[ -z "$VERSION_LINE" ]]; then
        echo "Error: bump script did not produce VERSION= line" >&2
        exit 1
    fi
    NEW_VERSION="${VERSION_LINE#VERSION=}"
    echo "[pack] new version: $NEW_VERSION"
else
    echo "[pack] skipping version bump (--no-bump)"
fi

# 2. Build
echo ""
echo "=== Step 2: build DeskFox (env=$ENV) ==="
"$SCRIPT_DIR/build-deskfox.sh" -Env "$ENV"
BUILD_EXIT=$?
if [[ "$BUILD_EXIT" -ne 0 ]]; then
    echo "[pack] build failed with exit $BUILD_EXIT" >&2
    exit "$BUILD_EXIT"
fi

APP_PATH="$REPO_ROOT/packages/desktop/src-tauri/target/release/bundle/macos"
DMG_DIR="$REPO_ROOT/packages/desktop/src-tauri/target/release/bundle/dmg"

# 2.5 Rename .dmg with installer version
# Tauri 出的 .dmg 文件名取自 package.json 的 version(上游 contract,不能改)。
# 导致名字带的是上游版本(1.14.21)而非 installer 版本(YYYY.M.D.N)。
# 这里把它 mv 成 installer 版本号命名,与 Win 的 DeskFox-YYYY.M.D.N-setup.exe 对齐。
# 文件内部 CFBundleShortVersionString 仍是上游版本(改它要动 package.json 会跟上游冲突)。
if [[ -n "$NEW_VERSION" && -d "$DMG_DIR" ]]; then
    # FORK: 版本号用 NumericVersion(strip env suffix),对齐 Win DeskFox.iss OutputBaseFilename
    # 用 NumericAppVersion 的设计;productName 空格转横杠跟 Win 命名一致("DeskFox Dev" → "DeskFox-Dev")
    # 例:beta 产物 "DeskFox Beta_1.14.21_aarch64.dmg" + NEW_VERSION="2026.5.21.1-beta"
    #     → "DeskFox-Beta-2026.5.21.1_aarch64.dmg"(空格转横杠 + strip -beta 后缀)
    # [feat: ship-scripts-naming-fix] 2026-05-21
    NUMERIC_VERSION=$(echo "$NEW_VERSION" | sed -E 's/-(dev|beta)$//')
    for dmg in "$DMG_DIR"/*.dmg; do
        [[ -f "$dmg" ]] || continue
        base=$(basename "$dmg")
        # Tauri 命名规则:<productName>_<package.json version>_<arch>.dmg
        # productName 可能含空格(如 "DeskFox Beta"),用 bash parameter expansion 不依赖 IFS
        without_ext="${base%.dmg}"
        arch_part="${without_ext##*_}"           # 取最后 _ 之后(arch,如 aarch64)
        rest="${without_ext%_*}"                  # 去掉 _arch
        product_part="${rest%_*}"                 # 再去掉 _<oldver>(剩 productName,含空格)
        product_part_clean="${product_part// /-}" # 空格 → 横杠,跟 Win 命名风格对齐
        new_name="${product_part_clean}-${NUMERIC_VERSION}_${arch_part}.dmg"
        if [[ "$base" != "$new_name" ]]; then
            mv "$dmg" "$DMG_DIR/$new_name"
            echo "[pack] renamed: $base → $new_name"
        fi
    done
fi

# 3. Report artifacts
echo ""
echo "=== Step 3: artifacts ==="
BIN_PATH="$REPO_ROOT/packages/desktop/src-tauri/target/release/DeskFox"

echo "[pack] installer ready:"
if [[ -f "$BIN_PATH" ]]; then
    SIZE=$(stat -f%z "$BIN_PATH" 2>/dev/null || stat -c%s "$BIN_PATH" 2>/dev/null || echo "?")
    echo "  raw binary: $BIN_PATH ($SIZE bytes)"
fi
# Find .app
for app in "$APP_PATH"/*.app; do
    if [[ -d "$app" ]]; then
        echo "  .app bundle: $app"
    fi
done
# Find .dmg
for dmg in "$DMG_DIR"/*.dmg; do
    if [[ -f "$dmg" ]]; then
        SIZE=$(stat -f%z "$dmg" 2>/dev/null || stat -c%s "$dmg" 2>/dev/null || echo "?")
        echo "  .dmg: $dmg ($SIZE bytes)"
    fi
done
# FORK: macos-updater-adapt 2026-06-06 — 列 updater 产物(.app.tar.gz + .sig)。
# prod/beta override 的 createUpdaterArtifacts:true + TAURI_SIGNING_PRIVATE_KEY 就位时 build 期产出;
# ship 流程用这两个路径调 finalize-latest-json.ts 生成 latest.json。缺 .sig 则 updater 无法验签升级。
for tarball in "$APP_PATH"/*.app.tar.gz; do
    if [[ -f "$tarball" ]]; then
        SIZE=$(stat -f%z "$tarball" 2>/dev/null || stat -c%s "$tarball" 2>/dev/null || echo "?")
        echo "  updater bundle: $tarball ($SIZE bytes)"
        if [[ -f "$tarball.sig" ]]; then
            echo "  updater sig:    $tarball.sig"
        else
            echo "  ⚠️  updater sig 缺失:$tarball.sig — updater 无法验签升级(检查 TAURI_SIGNING_PRIVATE_KEY)"
        fi
    fi
done

echo ""
if [[ -n "$NEW_VERSION" ]]; then
    echo "[pack] version: $NEW_VERSION"
fi
echo "[pack] remember to fill the placeholder in docs/installer-versions.md with summary after testing"
echo ""
echo "macOS Gatekeeper: right-click .app -> Open -> Open Anyway"
echo "or: xattr -cr \"$APP_PATH\"/*.app"
