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

# FORK-BEGIN: sidecar minos 回贴 — 让 Bun sidecar 能在 macOS 12 Monterey 运行 [feat: macos-monterey-no-launch] 2026-06-08
# 现象:Monterey 12 用户装完点 DeskFox "没反应"。根因:Bun 1.3.x runtime 二进制被标成
# minos 13.0(LC_BUILD_VERSION),dyld 在 macOS 12 上直接拒绝加载 sidecar → 后端进程起不来。
# 主程序(Tauri/Rust minos 11.0)+ .app 本身能在 12 启动,唯一卡点就是这个 13.0 标记。
# 据 Bun issue #15873,该标记是编译配置问题,实际代码可在 macOS 12 运行。把 sidecar minos
# 降回 12.0(与下方 minimumSystemVersion=12.0 floor 对齐),Tauri build 随后用 Developer ID 重签
# (prod)/ 此处的 ad-hoc 签名(dev)。必须在 Tauri 签名前 patch,否则改 load command 会废掉签名。
# 仅 darwin 执行;vtool / codesign 来自 Xcode CLT。
# ⚠️ 这是赌 Bun 实际不依赖 macOS 13 独有符号(issue 实测的是 1.1.40,我们用 1.3.14)。
#    打包后必须在真 macOS 12 机器上启动验证,确认 sidecar 真能跑、不是 dyld symbol-not-found。
if [[ "$(uname)" == "Darwin" && -f "$SIDECAR_PATH" ]]; then
    SIDECAR_MINOS="$(vtool -show-build "$SIDECAR_PATH" 2>/dev/null | awk '/minos/{print $2; exit}')"
    if [[ "$SIDECAR_MINOS" == "12.0" ]]; then
        echo "[deskfox] sidecar minos already 12.0 ✓"
    else
        SIDECAR_SDK="$(vtool -show-build "$SIDECAR_PATH" 2>/dev/null | awk '/sdk/{print $2; exit}')"
        [[ -z "$SIDECAR_SDK" || "$SIDECAR_SDK" == "n/a" ]] && SIDECAR_SDK="13.0"
        echo "[deskfox] sidecar minos $SIDECAR_MINOS -> 12.0 (Monterey 兼容, Bun issue #15873)"
        vtool -set-build-version macos 12.0 "$SIDECAR_SDK" -replace \
              -output "$SIDECAR_PATH" "$SIDECAR_PATH"
        # vtool 改了 load command → 原签名失效;先 ad-hoc 重签(arm64 必须有效签名才能 exec)。
        # prod 构建后 Tauri 会用 Developer ID 覆盖此签名(签名不改 minos,12.0 保留);dev 留 ad-hoc 即可运行。
        codesign --force --sign - "$SIDECAR_PATH" 2>/dev/null || true
        SIDECAR_MINOS_NEW="$(vtool -show-build "$SIDECAR_PATH" 2>/dev/null | awk '/minos/{print $2; exit}')"
        if [[ "$SIDECAR_MINOS_NEW" != "12.0" ]]; then
            echo "[deskfox] ERROR: sidecar minos patch 失败(仍为 $SIDECAR_MINOS_NEW),Monterey 用户仍会卡死。" >&2
            exit 1
        fi
        echo "[deskfox] sidecar minos patched -> 12.0 + ad-hoc 重签 ✓"
    fi
fi
# FORK-END

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
    # [feat: lo-bundle-coldstart-smoke-gate 2026-06-08] bundle 完整性校验 — 挡"fix 前的过期 bundle"。
    # presets/ + extensions/ 是 LO 冷启动建 user profile 的硬依赖(prepare-lo-bundle.sh 已保留 + smoke 验证);
    # 缺任一 = 此 bundle 由过度剥皮的旧脚本产出 → 打包必致干净机器 "User installation could not be completed"。
    LO_RES="$LO_BUNDLE_APP/Contents/Resources"
    for _req in presets extensions; do
        if [[ ! -d "$LO_RES/$_req" ]]; then
            echo "[deskfox] ERROR: LO bundle 缺 Contents/Resources/$_req — 过期/过度剥皮的 bundle,打包必致干净机器 LO fatal error。" >&2
            echo "[deskfox]   重跑 prepare-lo-bundle.sh 重做 bundle(内置冷启动 smoke 闸,保证产出健康 bundle)。" >&2
            exit 1
        fi
    done
    # 路径相对于 packages/desktop/src-tauri/(同 tauri.conf.json resources 约定)
    LO_EXTRA_CONFIG='{"bundle":{"resources":{"../../branding/libreoffice-bundle/macos/LibreOffice.app":"libreoffice"}}}'

    # 无预签名 — 嵌套 bundle 签名必须在 Tauri 构建后按顺序做(见步骤 2.5)
elif [[ "$NO_BUNDLE" -eq 1 ]]; then
    # Tier 3 本地测试版(--no-bundle raw exe,不发布)— 允许无 LO,仅本机自测 office 功能不可用
    echo "[deskfox] LO bundle not found: $LO_BUNDLE_APP"
    echo "[deskfox]   --no-bundle(Tier 3 raw exe 自测)→ 允许无 LO 继续;本机 office 功能不可用"
    echo "[deskfox]   需要 LO 时先跑 prepare-lo-bundle.sh"
else
    # [feat: lo-bundle-coldstart-smoke-gate 2026-06-08] 出货硬失败 — 绝不静默出"不含 LO"的发布包。
    # 出真包(Tier 1 prod / Tier 2 dev preview,无 --no-bundle)= 发布物,LO 必须有;缺了直接 exit 1,
    # 不再 warning 后继续(那等于静默降级:用户 office 功能退回首次下载、常失败,正是 lo-bundle 要消灭的)。
    echo "[deskfox] ERROR: 发布物构建(Tier 1/2,出 .app/.dmg)但 LO bundle 不存在: $LO_BUNDLE_APP" >&2
    echo "[deskfox]   绝不静默出不含 LibreOffice 的发布包。先跑 prepare-lo-bundle.sh 做出健康 bundle" >&2
    echo "[deskfox]   (内置冷启动 smoke 闸,保证产出健康 bundle)再构建发布物。" >&2
    echo "[deskfox]   (仅本机 raw exe 自测可加 --no-bundle 跳过 LO)" >&2
    exit 1
fi

# === 1.6 FORK: [启用自动升级/版本号注入] 2026-06-05 — 注入真实版本号(修历史 app version=0.0.0)===
# 镜像 build-deskfox.ps1 同名段(已在 Win 实测验证):Tauri generate_context! 编译时从 on-disk
# tauri.conf.json 烧录 app version;上游 "version":"../package.json" 在 v2 是非法 semver → 回落 0.0.0,
# 且 --config(走 env)不触发 cargo 重编。唯一可靠杠杆:patch on-disk tauri.conf.json(tauri-build
# rerun-if-changed 强制重编宏)→ 版本号真进二进制(updater package_info().version)。build 后 git 还原。
# Mac 读 installer-versions.json。版本号规则见 docs/governance/版本号与发布渠道规范.md §三。
# env 选号线:prod 读裸 `macos`;dev/beta 读独立号线 `dev-macos`/`beta-macos`(dev 领先模式,§3.2)。
# 兜底:复合 key 缺失时回落裸 `macos`(老 JSON / 未 seed 的 channel 不致 build 失败)。
VERSIONS_JSON="$BRANDING_ROOT/installer-versions.json"
VERSION_KEY="macos"
[[ "$ENV" != "prod" ]] && VERSION_KEY="$ENV-macos"
APP_VERSION="$(bun -e "const v=require('$VERSIONS_JSON'); console.log(v['$VERSION_KEY'] ?? v.macos)")"
if [[ -z "$APP_VERSION" || "$APP_VERSION" == "undefined" ]]; then
    echo "[deskfox] ERROR: installer-versions.json missing version (key=$VERSION_KEY, fallback macos)" >&2
    exit 1
fi
echo "[deskfox] version line: $VERSION_KEY"
BASE_CONF="$REPO_ROOT/packages/desktop/src-tauri/tauri.conf.json"
perl -0777 -i -pe 's/"version"\s*:\s*"[^"]*"/"version": "'"$APP_VERSION"'"/' "$BASE_CONF"
echo "[deskfox] app version injected -> $APP_VERSION (tauri.conf.json on-disk patch, macos)"

# === 2. tauri build ===
BUILD_EXIT=0
(
    cd "$REPO_ROOT/packages/desktop"
    TAURI_CONFIGS=("--config" "$OVERRIDE")
    if [[ -n "$LO_EXTRA_CONFIG" ]]; then
        TAURI_CONFIGS+=("--config" "$LO_EXTRA_CONFIG")
    fi
    # FORK: 显式钉 macOS floor=12.0(与上方 sidecar minos patch 对齐)[feat: macos-monterey-no-launch] 2026-06-08
    # 经 --config 注入不动 base tauri.conf.json(merge-safe)。同时设主二进制 minos + Info.plist
    # LSMinimumSystemVersion=12.0:① 与 sidecar 12.0 一致,声明真实支持下限 ② 低于 12 的用户在
    # 安装/启动时收到明确"需要 macOS 12"弹窗,而不是把"死图标"bug 平移到 Big Sur 11 用户。
    TAURI_CONFIGS+=("--config" '{"bundle":{"macOS":{"minimumSystemVersion":"12.0"}}}')
    if [[ "$NO_BUNDLE" -eq 1 ]]; then
        bun run tauri build --no-bundle "${TAURI_CONFIGS[@]}"
    else
        bun run tauri build "${TAURI_CONFIGS[@]}"
    fi
) || BUILD_EXIT=$?

# === 2.4 post-build 验证:最终 .app 真含可执行 soffice(挡"LO 没打进包")===
# [feat: lo-bundle-coldstart-smoke-gate 2026-06-08] 闸 2:即使输入 bundle 健康(闸 1 + prepare smoke 已保证),
# 也可能因 Tauri resources 配置/打包意外没把 LO 注入最终 .app。出货构建在测试阶段拦住:
# 出真包(LO_EXTRA_CONFIG 已设 + 非 --no-bundle)且 build 成功 → 验证 .app 内 soffice 存在且可执行,缺则 exit 1。
# (此处 soffice 尚未 Developer ID 签名,2.5 才签,故只做结构性存在检查;冷启动行为由 prepare smoke 已验证。)
if [[ -n "$LO_EXTRA_CONFIG" && "$NO_BUNDLE" -eq 0 && "$BUILD_EXIT" -eq 0 ]]; then
    VERIFY_SOFFICE="$REPO_ROOT/packages/desktop/src-tauri/target/release/bundle/macos/DeskFox.app/Contents/Resources/libreoffice/Contents/MacOS/soffice"
    if [[ ! -x "$VERIFY_SOFFICE" ]]; then
        echo "[deskfox] ERROR: 打包后最终 .app 内未找到可执行 soffice: $VERIFY_SOFFICE" >&2
        echo "[deskfox]   输入 bundle 健康但没注入最终包(疑 Tauri resources 配置/打包问题)。" >&2
        echo "[deskfox]   绝不发布不含 LibreOffice 的包;排查 LO_EXTRA_CONFIG 注入与 tauri build resources。" >&2
        exit 1
    fi
    echo "[deskfox] post-build verify: 最终 .app 含可执行 soffice ✓"
fi

# === 2.5 post-build: 对 .app 里的 LO 嵌套 bundle 做正确顺序的 Developer ID 签名 + 重建 DMG ===
# Apple 嵌套 bundle 签名规则:先签叶节点(dylib),再签 executable,再签 inner bundle,最后签 outer bundle。
# Tauri 只签 Contents/MacOS/(sidecar + main binary)和 .app 本体,不覆盖 Resources/ 子树。
# 因此 LO bundle 需要在 Tauri 签完 .app 后手动补签,然后重新封 DeskFox.app 外层 seal,最后重建 DMG。
if [[ -n "$LO_EXTRA_CONFIG" && "$SIGN_ENABLED" -eq 1 && "$BUILD_EXIT" -eq 0 && "$NO_BUNDLE" -eq 0 ]]; then
    APP_BUNDLE="$REPO_ROOT/packages/desktop/src-tauri/target/release/bundle/macos/DeskFox.app"
    LO_IN_APP="$APP_BUNDLE/Contents/Resources/libreoffice"
    ENTITLEMENTS="$REPO_ROOT/packages/desktop/src-tauri/entitlements.plist"
    if [[ -d "$LO_IN_APP" ]]; then
        echo "[deskfox] === post-build LO signing (nested bundle order) ==="

        # 1-3. 用 --deep 一次性签 LO 内所有组件(按 inner→outer 顺序):
        #   - Frameworks/ 下的 .dylib / .so / .jnilib
        #   - PlugIns/ 下的 .appex (App Extension 子 bundle)
        #   - Library/Spotlight/ 下的 .mdimporter
        #   - Contents/MacOS/ 下的可执行文件(soffice 等)
        #   - LO inner bundle 本体 seal
        # --deep 按正确顺序处理所有嵌套层级,--force 覆盖现有 ad-hoc 签名
        # FORK: 必带 --entitlements,否则 LO 内 soffice 等可执行文件在 hardened runtime
        # (--options runtime) 下缺 com.apple.security.cs.allow-jit → UNO 桥建 vtable 时
        # JIT 被内核拒 → SIGABRT,签名版 Office 预览(Word/Excel/PPT)全崩。外层 step 4
        # re-seal 带 entitlements 但不带 --deep,碰不到 LO 内层 executable,必须在此处刷入。
        # [bug-repro: signed LO soffice missing allow-jit -> SIGABRT on Office preview] 2026-06-06 REQ-050
        echo "[deskfox] steps 1-3: signing LO nested bundle with --deep..."
        codesign --sign "$APPLE_SIGNING_IDENTITY" \
                 --options runtime \
                 --timestamp \
                 --force \
                 --deep \
                 --entitlements "$ENTITLEMENTS" \
                 "$LO_IN_APP" 2>&1 | tail -3 || true
        echo "[deskfox]   LO deep-signed with entitlements (allow-jit) — soffice JIT enabled"

        # 4. 重签 DeskFox.app 外层 seal(不带 --deep,只更新 outer seal 覆盖新 LO seal)
        echo "[deskfox] step 4: re-sealing DeskFox.app outer bundle..."
        codesign --sign "$APPLE_SIGNING_IDENTITY" --options runtime --timestamp --force \
                 --entitlements "$ENTITLEMENTS" \
                 "$APP_BUNDLE" 2>/dev/null \
            && echo "[deskfox]   DeskFox.app re-sealed OK" || echo "[deskfox]   DeskFox.app re-seal WARN"

        # 5. 重建 DMG(Tauri 已经建了一个,但那个 .app 是重签前的;重建保证 DMG 里是正确签名的版本)
        echo "[deskfox] step 5: recreating DMG from re-signed .app..."
        DMG_DIR="$REPO_ROOT/packages/desktop/src-tauri/target/release/bundle/dmg"
        OLD_DMG=$(ls "$DMG_DIR"/*.dmg 2>/dev/null | grep -v "DeskFox Dev" | head -1)
        if [[ -z "$OLD_DMG" ]]; then
            OLD_DMG=$(ls "$DMG_DIR"/*.dmg 2>/dev/null | head -1)
        fi
        if [[ -n "$OLD_DMG" ]]; then
            rm -f "$OLD_DMG"
            DMG_VOLNAME=$(basename "$APP_BUNDLE" .app)

            # === DMG 布局流程(标准 macOS drag-to-install 体验) ===
            # 1. 先建可读写 UDRW 镜像(含 .app + /Applications 快捷方式)
            # 2. 挂载后用 AppleScript 设置 Finder 窗口大小 + 图标位置
            #    布局(规范固化值,user 2026-06-05 拍板):窗口 640×400(bounds {400,100,1040,500}),
            #    图标 128px,DeskFox 左(180,200),Applications 右(460,200)。改这些值前先出预览 dmg 给 user 看。
            # 3. 挂载期间 macOS 会自动建 .fseventsd — 在 AppleScript 前后各删一次,防止出现在用户界面
            # 4. 转成压缩 UDZO 最终分发格式
            DMG_STAGING=$(mktemp -d)
            DMG_TMPIMG=$(mktemp /tmp/deskfox_rw_XXXXXX.dmg)
            # BSD mktemp 只替换结尾的 X;模板带 .dmg 后缀 → 不替换 → 返回字面路径并已建 0 字节占位文件。
            # hdiutil create 拒绝写已存在文件("File exists" → set -e 静默 abort 死在 step 5)。
            # 删掉占位文件让 hdiutil 新建;顺带自愈前次崩溃残留的同名文件。[bug-repro: hdiutil create File exists] 2026-06-04
            rm -f "$DMG_TMPIMG"
            cp -R "$APP_BUNDLE" "$DMG_STAGING/DeskFox.app"
            ln -s /Applications "$DMG_STAGING/Applications"
            hdiutil create -srcfolder "$DMG_STAGING" \
                           -volname "$DMG_VOLNAME" \
                           -fs HFS+ -format UDRW \
                           -size 1600m \
                           "$DMG_TMPIMG" 2>/dev/null
            rm -rf "$DMG_STAGING"

            DMG_MOUNT_PT=$(hdiutil attach "$DMG_TMPIMG" -readwrite -noverify -noautoopen 2>/dev/null \
                           | tail -1 | awk -F'\t' '{print $NF}')

            if [[ -n "$DMG_MOUNT_PT" ]]; then
                # 第一轮清除(挂载后 macOS 立即建的)
                rm -rf "$DMG_MOUNT_PT/.fseventsd" "$DMG_MOUNT_PT/.Spotlight-V100" "$DMG_MOUNT_PT/.Trashes" 2>/dev/null || true

                # AppleScript 设置 Finder 窗口布局
                osascript 2>/dev/null <<APPLESCRIPT
tell application "Finder"
  tell disk "$DMG_VOLNAME"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set bounds of container window to {400, 100, 1040, 500}
    set theViewOptions to icon view options of container window
    set arrangement of theViewOptions to not arranged
    set icon size of theViewOptions to 128
    set position of item "DeskFox.app" of container window to {180, 200}
    set position of item "Applications" of container window to {460, 200}
    update without registering applications
    delay 3
    close
  end tell
end tell
APPLESCRIPT

                # 第二轮清除(Finder 打开期间 macOS 可能重建)
                rm -rf "$DMG_MOUNT_PT/.fseventsd" "$DMG_MOUNT_PT/.Spotlight-V100" "$DMG_MOUNT_PT/.Trashes" 2>/dev/null || true
                sync

                hdiutil detach "$DMG_MOUNT_PT" -force 2>/dev/null
            fi

            hdiutil convert "$DMG_TMPIMG" -format UDZO -imagekey zlib-level=9 -o "$OLD_DMG" 2>/dev/null \
                && echo "[deskfox]   DMG recreated with layout (DeskFox left, Applications right): $OLD_DMG" \
                || echo "[deskfox]   DMG recreate WARN"
            rm -f "$DMG_TMPIMG"
            # FORK: 重建的 dmg 是 hdiutil convert 产物(未签名)— 必须补签 Developer ID。
            # 否则 3.6 公证块提交的是未签名 dmg:apple 仍 Accept(只查内部 .app),但 staple 后
            # spctl -t open 判 "no usable signature",用户下载双击挂载被 Gatekeeper 拦。
            # 顺序铁律:签 dmg → 公证(3.6)→ staple;公证后再签会改 hash 废掉 ticket。
            # [bug-repro: recreated dmg unsigned -> spctl no usable signature] 2026-06-04
            codesign --force --sign "$APPLE_SIGNING_IDENTITY" --timestamp "$OLD_DMG" \
                && echo "[deskfox]   DMG re-signed (Developer ID): $OLD_DMG" \
                || echo "[deskfox]   DMG re-sign WARN"
        fi

        echo "[deskfox] === post-build LO signing complete ==="
    fi
fi

# === 2.6 (FORK: macos-updater-adapt 2026-06-06) updater 产物:基于最终签名 .app 重新打包 + 签名 ===
# 为什么重新生成而非直接用 Tauri build 时产的 tarball:
#   ① 2.5 LO 重签改了 .app → Tauri build 时刻的 .app.tar.gz 含「重签前」.app(过期,LO 子 bundle ad-hoc 签名)
#   ② createUpdaterArtifacts 构建期签名偶发失败(对称 build-deskfox.ps1 step 3.6 实证)
# 统一在 .app 定型(LO 重签 + Apple 签名完成)后重新 tar + tauri signer sign,保证 updater tarball == 最终 .app 且 .sig 匹配。
# 仅 prod/beta(override createUpdaterArtifacts:true)+ 有私钥(prod source config.env)+ 出 bundle 时执行;dev 不产 updater。
if [[ "$NO_BUNDLE" -eq 0 && "$ENV" != "dev" && -n "${TAURI_SIGNING_PRIVATE_KEY:-}" && "$BUILD_EXIT" -eq 0 ]]; then
    MACOS_BUNDLE_DIR="$REPO_ROOT/packages/desktop/src-tauri/target/release/bundle/macos"
    UPDATER_APP=$(ls -d "$MACOS_BUNDLE_DIR"/*.app 2>/dev/null | grep -v "Dev.app" | head -1 || true)
    [[ -z "$UPDATER_APP" ]] && UPDATER_APP=$(ls -d "$MACOS_BUNDLE_DIR"/*.app 2>/dev/null | head -1 || true)
    if [[ -n "$UPDATER_APP" && -d "$UPDATER_APP" ]]; then
        echo "[deskfox] === 2.6 updater 产物:重新打包 + 签名(基于最终签名 .app)==="
        APP_BASE=$(basename "$UPDATER_APP")              # 例 DeskFox.app
        TARBALL="$MACOS_BUNDLE_DIR/$APP_BASE.tar.gz"     # Tauri updater 命名 = <AppName>.app.tar.gz
        rm -f "$TARBALL" "$TARBALL.sig"
        # Tauri macOS updater tarball = gzip tar of .app(相对 bundle 目录,保留 .app 顶层 + 内部 symlink)
        # FORK: COPYFILE_DISABLE=1 禁止 macOS tar 写 AppleDouble(`._<name>`)元数据成员 —— 否则 .app 的扩展
        # 属性被打成 tarball 首条 `._DeskFox.app` entry(bsdtar 自己隐藏、GNU/Rust tar 可见),Tauri updater
        # install_inner 的 `path.iter().skip(1)` 把它折成空路径 → 把普通文件 unpack 到临时目录本身 → EPERM
        # → 用户点"安装并重启"后解压第 0 步即抛错、升级静默失败(app 完好停在旧版)。复现见 docs/features。
        # [bug-repro: auto-updater 安装/检查静默失败] 2026-06-12
        ( cd "$MACOS_BUNDLE_DIR" && COPYFILE_DISABLE=1 tar -czf "$APP_BASE.tar.gz" "$APP_BASE" ) || echo "[deskfox]   ❌ tarball 打包失败"
        # FORK: 防回归断言 —— 用 python3 看 tarball 的 raw 成员(bsdtar `tar tzf` 会隐藏 `._`,不可靠)。
        # 一旦混入任何 AppleDouble(`._`)成员,Tauri updater 解压必 EPERM 静默失败 → 删毒产物 + 报错,
        # 让后续签名/部署拿不到 tarball 而安全失败,绝不把坏升级包发出去。[bug-repro: auto-updater 安装/检查静默失败] 2026-06-12
        if [[ -f "$TARBALL" ]] && command -v python3 >/dev/null 2>&1; then
            AD_COUNT=$(python3 -c "import tarfile,sys; t=tarfile.open(sys.argv[1]); print(sum(1 for n in t.getnames() if n.rsplit('/',1)[-1].startswith('._')))" "$TARBALL" 2>/dev/null || echo "?")
            if [[ "$AD_COUNT" != "0" ]]; then
                echo "[deskfox]   ❌❌ updater tarball 含 $AD_COUNT 个 AppleDouble(._)成员 → 升级安装会 EPERM 静默失败!删除毒产物,检查 COPYFILE_DISABLE" >&2
                rm -f "$TARBALL" "$TARBALL.sig"
            else
                echo "[deskfox]   ✅ tarball 无 AppleDouble 成员(防回归校验通过)"
            fi
        fi
        if [[ -f "$TARBALL" ]]; then
            T_SIZE=$(stat -f%z "$TARBALL" 2>/dev/null || echo "?")
            echo "[deskfox]   tarball: $TARBALL ($T_SIZE bytes)"
            # tauri signer sign 从 env 读 TAURI_SIGNING_PRIVATE_KEY(+_PASSWORD),产 <tarball>.sig
            ( cd "$REPO_ROOT/packages/desktop" && bun run tauri signer sign "$TARBALL" >/dev/null 2>&1 ) \
                && echo "[deskfox]   ✅ updater .sig: $TARBALL.sig" \
                || echo "[deskfox]   ❌ updater 签名失败(检查 TAURI_SIGNING_PRIVATE_KEY / _PASSWORD)"
        fi
    fi
fi

# === 3. restore(无论 build 成败都还原)===
bash "$SCRIPT_DIR/restore-icons.sh"
# 还原 tauri.conf.json(版本号只在 build 期间临时改,不入仓)— 同 build-deskfox.ps1
git -C "$REPO_ROOT" checkout HEAD -- packages/desktop/src-tauri/tauri.conf.json 2>/dev/null || true

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
        echo "[deskfox] 提交公证(通常 5-30 min,含 LO bundle 的大 DMG 可能需 1-2h):$(basename "$DMG")"
        # FORK: 含 LO bundle 的 DMG 约 270MB,苹果公证实测需 ~2h;原 30m 超时不够用 2026-06-03
        if xcrun notarytool submit "$DMG" \
             --key "$DESKFOX_NOTARY_KEY" \
             --key-id "$DESKFOX_NOTARY_KEY_ID" \
             --issuer "$DESKFOX_NOTARY_ISSUER" \
             --wait --timeout 2h; then
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
