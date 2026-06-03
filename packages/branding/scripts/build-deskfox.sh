#!/usr/bin/env bash
# [fork-only] DeskFox 一键构建 wrapper(macOS / Linux 版,对称 build-deskfox.ps1)
#
# 流程:
#   0. (auto)确保 sidecar 已 build — RUST_TARGET=<host triple>;packages/opencode/ 出 cli binary
#   1. apply-icons.sh   把 DeskFox PNG/.ico/.icns 临时拷到 src-tauri/icons/{env}/
#   2. tauri build      --config tauri-overrides/<env>.json
#   3. restore-icons.sh git checkout HEAD -- src-tauri/icons/(还原工作树)
#
# 用法:
#   bash packages/branding/scripts/build-deskfox.sh -Env dev
#   bash packages/branding/scripts/build-deskfox.sh -Env prod
#   bash packages/branding/scripts/build-deskfox.sh -Env beta
#   bash packages/branding/scripts/build-deskfox.sh -Env prod --no-bundle  # 跳过 dmg/app bundle,只产 raw binary

set -e

ENV=""
NO_BUNDLE=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        -Env|--env|-e)
            ENV="$2"
            shift 2
            ;;
        --no-bundle|-NoBundle)
            NO_BUNDLE=1
            shift
            ;;
        *)
            echo "Unknown arg: $1" >&2
            exit 1
            ;;
    esac
done

if [[ "$ENV" != "dev" && "$ENV" != "beta" && "$ENV" != "prod" ]]; then
    echo "Usage: $0 -Env <dev|beta|prod> [--no-bundle]" >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRANDING_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$BRANDING_ROOT/../.." && pwd)"

OVERRIDE="$BRANDING_ROOT/tauri-overrides/$ENV.json"
if [[ ! -f "$OVERRIDE" ]]; then
    echo "tauri override not found: $OVERRIDE" >&2
    exit 1
fi

# === 0. 确保 sidecar 已 build(自动检测 host RUST_TARGET) ===
# 上游 packages/desktop/scripts/predev.ts 里的逻辑:
#   - macOS arm64    → aarch64-apple-darwin     → opencode-darwin-arm64
#   - macOS x64      → x86_64-apple-darwin      → opencode-darwin-x64-baseline
#   - Linux x64      → x86_64-unknown-linux-gnu → opencode-linux-x64-baseline
#   - Linux arm64    → aarch64-unknown-linux-gnu → opencode-linux-arm64

# FORK-BEGIN: feishu-pipeline-401-fix(2026-05-23)
# 锁 sidecar baked CHANNEL=prod,避免 git branch 名漂移触发上游 HTTPAPI 默认 ON 路径。
#
# 背景:packages/script/src/index.ts:30 读 `git branch --show-current` 作为 fallback,
# 当时主分支叫 dev → CHANNEL=dev → InstallationChannel 命中 HTTPAPI_DEFAULT_ON_CHANNELS
# (`["dev", "beta", "local"]`,见 packages/core/src/flag/flag.ts:16)→ sidecar 默认走
# 上游不成熟的 effect-httpapi stack。该 stack 当前两个已知 bug 撞死飞书桥接的
# session.messages 调用(① Authorization 多 security 实现成 AND 而非 OR → 401;
# ② StepFinishPart schema 要求 reason 必填但 DB 实际可能缺 → 编码 400)。
#
# 锁 CHANNEL=prod 让 InstallationChannel="prod" → 不在 HTTPAPI_DEFAULT_ON_CHANNELS
# 集合内 → HTTPAPI OFF → 走稳定的 Hono legacy stack(c.json 直出,不做 Schema 编码,
# 两个 sub-bug 都规避)。**这也是上游 prod 渠道用户 + Win 端实际在用的路径**。
#
# 后续上游 effect-httpapi 稳定后(或我们决定 dogfood)可移除这行。
export OPENCODE_CHANNEL=prod
# FORK-END

detect_rust_target() {
    local os arch
    os="$(uname -s)"
    arch="$(uname -m)"
    case "$os/$arch" in
        Darwin/arm64)   echo "aarch64-apple-darwin" ;;
        Darwin/x86_64)  echo "x86_64-apple-darwin" ;;
        Linux/x86_64)   echo "x86_64-unknown-linux-gnu" ;;
        Linux/aarch64)  echo "aarch64-unknown-linux-gnu" ;;
        *) echo "" ;;
    esac
}

if [[ -z "$RUST_TARGET" ]]; then
    export RUST_TARGET="$(detect_rust_target)"
    if [[ -z "$RUST_TARGET" ]]; then
        echo "Cannot detect RUST_TARGET (uname=$(uname -s)/$(uname -m)). Set manually before run." >&2
        exit 1
    fi
fi
echo "[deskfox] RUST_TARGET=$RUST_TARGET"

# 绕过上游 packages/desktop/scripts/predev.ts:它会按 SIDECAR_BINARIES 表跑 build --single --baseline,
# Bun.compile 内部需要从 GitHub 拉 ~190MB 的 bun-darwin-arm64-baseline 运行时,clash/CI 网络常超时失败
# (实测 GitHub Actions macos-latest runner build 卡 57 分钟触发 1h 超时,2026-05-07 ship-mac-prod-2026.5.7.1)。
# DeskFox 用户群默认现代 CPU(都有 AVX2),baseline 二进制不需要兜底,直接 build --single 即可,
# 输出 dist/opencode-darwin-{arm64,x64}/bin/opencode,复用本机已有的 bun runtime,零下载。
# 跟 Win 侧 build-deskfox.ps1 同等修法(commit 696bbcc00 / [feat: post-sync-build-fix])。

# 把 RUST_TARGET 转成 build.ts 输出目录名:aarch64-apple-darwin → opencode-darwin-arm64
case "$RUST_TARGET" in
    aarch64-apple-darwin)   BUILD_DIR_NAME="opencode-darwin-arm64" ;;
    x86_64-apple-darwin)    BUILD_DIR_NAME="opencode-darwin-x64" ;;
    aarch64-unknown-linux-gnu) BUILD_DIR_NAME="opencode-linux-arm64" ;;
    x86_64-unknown-linux-gnu)  BUILD_DIR_NAME="opencode-linux-x64" ;;
    *) echo "Unknown RUST_TARGET=$RUST_TARGET, cannot map to build.ts dir" >&2; exit 1 ;;
esac

SIDECAR_PATH="$REPO_ROOT/packages/desktop/src-tauri/sidecars/opencode-cli-${RUST_TARGET}"
OPENCODE_SRC_DIR="$REPO_ROOT/packages/opencode/src"

# FORK: 时间戳判断 — sidecar 不存在 OR 旧于 packages/opencode/src/**/*.ts 任一源文件 → rebuild
# 跟 Win build-deskfox.ps1 commit b9581b76e ([feat: build-pipeline-sidecar-fix]) 同等修法
# 不加这条 → packages/opencode/src 改动几周不进 sidecar binary(2026-05-09 fix/macos-docx-viewer 实战教训)
need_rebuild_sidecar() {
    [[ ! -f "$SIDECAR_PATH" ]] && return 0
    # 找 src 内最新 .ts 文件 mtime
    local latest_src_mtime
    latest_src_mtime=$(find "$OPENCODE_SRC_DIR" -name "*.ts" -type f -exec stat -f%m {} + 2>/dev/null | sort -rn | head -1)
    [[ -z "$latest_src_mtime" ]] && return 1
    local sidecar_mtime
    sidecar_mtime=$(stat -f%m "$SIDECAR_PATH" 2>/dev/null)
    [[ -z "$sidecar_mtime" ]] && return 0
    [[ "$latest_src_mtime" -gt "$sidecar_mtime" ]]
}

if need_rebuild_sidecar; then
    if [[ ! -f "$SIDECAR_PATH" ]]; then
        echo "[deskfox] sidecar not found, building via 'bun run build --single' (no --baseline, RUST_TARGET=$RUST_TARGET)..."
    else
        echo "[deskfox] sidecar stale(packages/opencode/src 内有新于 sidecar 的 .ts), rebuilding..."
    fi
    (
        cd "$REPO_ROOT/packages/opencode"
        bun run build --single
    )
    SRC_BIN="$REPO_ROOT/packages/opencode/dist/$BUILD_DIR_NAME/bin/opencode"
    if [[ ! -f "$SRC_BIN" ]]; then
        echo "Error: sidecar build reported success but no binary at $SRC_BIN" >&2
        echo "Hint: 检查 bun 输出 / @opentui/core 安装" >&2
        exit 1
    fi
    # CI 干净 checkout 时 sidecars/ 目录可能不存在
    mkdir -p "$(dirname "$SIDECAR_PATH")"
    cp "$SRC_BIN" "$SIDECAR_PATH"
    chmod +x "$SIDECAR_PATH"
    echo "[deskfox] sidecar built: $(stat -f%z "$SIDECAR_PATH" 2>/dev/null || stat -c%s "$SIDECAR_PATH") bytes"
else
    echo "[deskfox] sidecar up-to-date: $SIDECAR_PATH"
fi

# === 0.5. 打飞书桥接 plugin(进 installer 资源)===
# 让 installer 装完即可用 — runtime 由 lib.rs setup hook 把 plugin 路径注入 user opencode 配置
bash "$SCRIPT_DIR/build-feishu-plugin.sh"

# === 0.6. 打 media-gen 创作 plugin(进 installer 资源,同飞书)[feat: media-gen-bundle] 2026-05-27 ===
# tauri.conf.json resources 引用 branding/plugin/media-gen/dist/plugin.js,必须在 tauri build 前产出
bash "$SCRIPT_DIR/build-media-gen-plugin.sh"

# === 1. apply icons(按 env 选样式)===
bash "$SCRIPT_DIR/apply-icons.sh" -Env "$ENV"

# === 1.5 注入 VITE_DESKFOX_ENV 让前端 logo.tsx Mark 组件按 env 选样式 ===
export VITE_DESKFOX_ENV="$ENV"

# === 1.8 (FORK) 代码签名配置:prod 构建若存在本地签名配置则启用 [feat: macos-codesign-notarize] 2026-06-01 ===
# ~/.deskfox-signing/config.env 导出 APPLE_SIGNING_IDENTITY,Tauri bundler 自动识别并签名 sidecar + .app
# (hardened runtime + entitlements.plist 均已就绪)。配置不存在(他人 clone / CI 无证书)则跳过,
# 产出 unsigned 包,不报错。身份/公证 key 全部来自本机私密配置,绝不入仓(见 feedback_open_source_privacy)。
SIGN_ENABLED=0
NOTARIZE_OK=0
if [[ "$ENV" == "prod" && -f "$HOME/.deskfox-signing/config.env" ]]; then
    # shellcheck disable=SC1090
    source "$HOME/.deskfox-signing/config.env"
    if [[ -n "$APPLE_SIGNING_IDENTITY" ]]; then
        SIGN_ENABLED=1
        echo "[deskfox] 代码签名已启用:$APPLE_SIGNING_IDENTITY"
    fi
else
    echo "[deskfox] 未启用代码签名(非 prod 或无 ~/.deskfox-signing/config.env)"
fi

# === 1.9 macOS LO bundle 检测 — 若 libreoffice-bundle/macos/LibreOffice.app 存在则注入 Tauri resources ===
# [feat: lo-bundle-macos]
# Windows 用 DeskFox.iss 条件编译;macOS 没有 NSIS,改在 build script 动态注入额外 --config。
# Tauri v2 支持多 --config 参数,后者 deep-merge 到前者。
# 路径约定(对应 office-installer.ts bundledSofficePath):
#   source: branding/libreoffice-bundle/macos/LibreOffice.app
#   dest in .app: Contents/Resources/libreoffice  (=LibreOffice.app 重命名)
#   soffice exec: Contents/Resources/libreoffice/Contents/MacOS/soffice
LO_BUNDLE_APP="$BRANDING_ROOT/libreoffice-bundle/macos/LibreOffice.app"
LO_EXTRA_CONFIG=""
if [[ -d "$LO_BUNDLE_APP" ]]; then
    LO_SIZE=$(du -sm "$LO_BUNDLE_APP" 2>/dev/null | awk '{print $1}')
    echo "[deskfox] LO bundle found: $LO_BUNDLE_APP (${LO_SIZE}MB) — injecting into Tauri resources"
    # 相对于 packages/desktop/src-tauri/ 的路径
    # 路径相对于 packages/desktop/src-tauri/(同 tauri.conf.json resources 约定)
    LO_EXTRA_CONFIG='{"bundle":{"resources":{"../../branding/libreoffice-bundle/macos/LibreOffice.app":"libreoffice"}}}'
else
    echo "[deskfox] LO bundle not found: $LO_BUNDLE_APP"
    echo "[deskfox]   building WITHOUT pre-bundled LibreOffice (users will download on first use)"
    echo "[deskfox]   run prepare-lo-bundle.sh to prepare the bundle"
fi

# === 2. tauri build ===
BUILD_EXIT=0
(
    cd "$REPO_ROOT/packages/desktop"
    TAURI_CONFIGS=("--config" "$OVERRIDE")
    if [[ -n "$LO_EXTRA_CONFIG" ]]; then
        TAURI_CONFIGS+=("--config" "$LO_EXTRA_CONFIG")
    fi
    if [[ "$NO_BUNDLE" -eq 1 ]]; then
        bun run tauri build --no-bundle "${TAURI_CONFIGS[@]}"
    else
        bun run tauri build "${TAURI_CONFIGS[@]}"
    fi
) || BUILD_EXIT=$?

# === 3. restore(无论 build 成败都还原)===
bash "$SCRIPT_DIR/restore-icons.sh"

if [[ "$BUILD_EXIT" -ne 0 ]]; then
    echo "[deskfox] Warning: tauri build exited with code $BUILD_EXIT" >&2
fi

# === 3.5 开发机 jsonc 清理(防多档累积 → multi-instance 双推 message)===
# 决策:产品 inject 逻辑不做"同 plugin 多物理路径"清理(普通用户不撞,详见 feishu_plugin_install.rs 头注释)。
# 开发机一台机器来回切 dev / prod / raw target → plugin 数组累积多个 entry → opencode loader 各 import → 3 instance
# → 3 WSSClient 同 appId 连飞书 → server 给多 connection 推同 user message 分配不同 message_id → "user 只发一条 IM 但 bot 弹卡两次"
# 这里 build 成功后顺手清,下次 DeskFox 启动 setup hook 自动 inject 当前 .app 路径(单 entry,正常状态)。
# [feat: feishu-plugin-dedup-decision] 2026-05-12
# [feat: build-script-json-fallback] 2026-05-12 — 同时检测 .jsonc + .json(对齐 setup hook
#   resolve_user_config_path,user 实际用哪个就清哪个;之前只查 .jsonc 漏掉 .json 用户)
if [[ "$BUILD_EXIT" -eq 0 ]]; then
    CONFIG_DIR="$HOME/.config/opencode"
    for FILE_NAME in opencode.jsonc opencode.json; do
        JSONC="$CONFIG_DIR/$FILE_NAME"
        if [[ ! -f "$JSONC" ]]; then continue; fi
        # grep -c 找到 0 个 match 时 stdout 仍输出 "0" + exit 1,旧 `|| echo 0` 兜底会再追加一个 "0"
        # → COUNT = "0\n0",[[ -gt 1 ]] arithmetic context 撞 "syntax error in expression (error token is '0')"
        # 改 `|| true`:grep 已经输出单行 "0",我们只需 substitution exit 0(防 set -e)即可
        # [bug-repro: build-deskfox.sh 跑出 stderr "0: syntax error in expression (error token is '0')",build 仍成功但 log 不干净]
        FEISHU_COUNT=$(grep -c "plugin/feishu-bridge" "$JSONC" 2>/dev/null || true)
        if [[ "$FEISHU_COUNT" -gt 1 ]]; then
            echo ""
            echo "[deskfox] $FILE_NAME 发现 $FEISHU_COUNT 个 feishu-bridge plugin entry,清理(下次 DeskFox 启动 setup hook 自动 inject 当前 .app)..."
            cp "$JSONC" "$JSONC.bak.build-cleanup"
            grep -v "plugin/feishu-bridge" "$JSONC.bak.build-cleanup" > "$JSONC.tmp"
            # 修复:删完 entry 后 plugin 数组最后一项可能留悬空逗号(",\n  ]" → "\n  ]")
            perl -i -0pe 's/,(\s*\])/\1/g' "$JSONC.tmp"
            mv "$JSONC.tmp" "$JSONC"
            echo "[deskfox] ✅ 已清,原文件备份至 $JSONC.bak.build-cleanup"
        fi

        # media-gen 创作 plugin 清理(2026-05-27,media-gen-bundle):移除旧开发仓 dev 路径条目
        # (packages/media-gen)+ 任何多余 plugin/media-gen 条目;下次启动 setup hook 注入当前资源路径单条。
        MG_COUNT=$(grep -c "media-gen" "$JSONC" 2>/dev/null || true)
        if [[ "$MG_COUNT" -ge 1 ]]; then
            echo "[deskfox] $FILE_NAME 发现 $MG_COUNT 个 media-gen plugin entry,清理(下次启动 setup hook 注入当前资源路径)..."
            [[ -f "$JSONC.bak.build-cleanup" ]] || cp "$JSONC" "$JSONC.bak.build-cleanup"
            grep -v "media-gen" "$JSONC" > "$JSONC.tmp"
            perl -i -0pe 's/,(\s*\])/\1/g' "$JSONC.tmp"
            mv "$JSONC.tmp" "$JSONC"
            echo "[deskfox] ✅ media-gen 已清"
        fi
    done
fi

# === 3.6 (FORK) 公证 + 钉票(仅 prod + 已签名 + Darwin + 出了 .dmg)[feat: macos-codesign-notarize] 2026-06-01 ===
# Tauri build 已用 Developer ID 签好 .app + .dmg,这里把 .dmg 提交苹果公证并 staple 票据。
# 公证一律用直接 API Key(--key/--key-id/--issuer),不用 --keychain-profile:
# 非交互 shell 读钥匙串会报 "User interaction is not allowed"(2026-05-29 实测)。
if [[ "$BUILD_EXIT" -eq 0 && "$SIGN_ENABLED" -eq 1 && "$(uname -s)" == "Darwin" ]]; then
    DMG_DIR="$REPO_ROOT/packages/desktop/src-tauri/target/release/bundle/dmg"
    DMG=$(ls "$DMG_DIR"/*.dmg 2>/dev/null | head -1)
    if [[ -n "$DMG" && -f "$DMG" ]]; then
        echo "[deskfox] 提交公证(5-15 min,偶发更久):$(basename "$DMG")"
        if xcrun notarytool submit "$DMG" \
             --key "$DESKFOX_NOTARY_KEY" \
             --key-id "$DESKFOX_NOTARY_KEY_ID" \
             --issuer "$DESKFOX_NOTARY_ISSUER" \
             --wait --timeout 30m; then
            xcrun stapler staple "$DMG"
            NOTARIZE_OK=1
            echo "[deskfox] ✅ 公证 + 钉票完成:$(basename "$DMG")"
        else
            echo "[deskfox] ⚠️ 公证失败,产出的是已签名但未公证的 .dmg(Sequoia 仍会拦)" >&2
        fi
    else
        echo "[deskfox] 未找到 .dmg,跳过公证" >&2
    fi
fi

# === 4. 提示产物路径 ===
echo ""
case "$(uname -s)" in
    Darwin)
        APP_PATH="$REPO_ROOT/packages/desktop/src-tauri/target/release/bundle/macos/DeskFox.app"
        DMG_DIR="$REPO_ROOT/packages/desktop/src-tauri/target/release/bundle/dmg"
        BIN_PATH="$REPO_ROOT/packages/desktop/src-tauri/target/release/DeskFox"
        if [[ -f "$BIN_PATH" ]]; then
            echo "✓ raw binary: $BIN_PATH"
        fi
        if [[ -d "$APP_PATH" ]]; then
            echo "✓ .app bundle: $APP_PATH"
        fi
        if [[ -d "$DMG_DIR" ]]; then
            echo "✓ .dmg dir:    $DMG_DIR"
            ls "$DMG_DIR"/*.dmg 2>/dev/null | sed 's/^/  /'
            # FORK: 给 .dmg 文件设自定义图标(Finder 里显示狐狸,不再是通用磁盘映像图标)
            # 需 brew install fileicon;未装则提示后跳过,不影响 build 2026-05-06
            if command -v fileicon >/dev/null 2>&1; then
                ICNS="$DMG_DIR/icon.icns"
                if [[ -f "$ICNS" ]]; then
                    for DMG in "$DMG_DIR"/*.dmg; do
                        [[ -f "$DMG" ]] || continue
                        if fileicon set "$DMG" "$ICNS" >/dev/null 2>&1; then
                            echo "  ✓ icon set on $(basename "$DMG")"
                        fi
                    done
                fi
            else
                echo "  (未装 fileicon — .dmg 用通用磁盘映像图标;装:brew install fileicon)"
            fi
        fi
        echo ""
        # FORK: 签名时提示已公证可直接打开,否则给未签名绕过指引 [feat: macos-codesign-notarize] 2026-06-01
        if [[ "${SIGN_ENABLED:-0}" -eq 1 && "${NOTARIZE_OK:-0}" -eq 1 ]]; then
            echo "✅ 已 Developer ID 签名 + 公证 — 用户下载双击直接打开,无 Gatekeeper 拦截"
        elif [[ "${SIGN_ENABLED:-0}" -eq 1 ]]; then
            echo "⚠️ 已 Developer ID 签名,但公证未完成(苹果侧超时/故障)— Sequoia 仍可能拦"
            echo "   待苹果服务恢复后单独补公证:bash ~/.deskfox-signing/3-notarize.sh \"<已签名.dmg>\""
        else
            echo "macOS Gatekeeper(未签名):首次打开 → 右键 .app → 打开 → 仍要打开"
            echo "或彻底去 quarantine:xattr -cr \"$APP_PATH\""
        fi
        ;;
    Linux)
        BIN_PATH="$REPO_ROOT/packages/desktop/src-tauri/target/release/DeskFox"
        if [[ -f "$BIN_PATH" ]]; then
            echo "✓ raw binary: $BIN_PATH"
        fi
        DEB_DIR="$REPO_ROOT/packages/desktop/src-tauri/target/release/bundle/deb"
        if [[ -d "$DEB_DIR" ]]; then
            echo "✓ .deb dir:   $DEB_DIR"
        fi
        ;;
esac

exit "$BUILD_EXIT"
