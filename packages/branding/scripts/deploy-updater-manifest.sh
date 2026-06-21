#!/usr/bin/env bash
# [DEPRECATED] Tauri updater 专用(latest.json + minisign),换 Electron 后(2026-06-15)作废。Electron updater 改走 deploy-electron-updater.sh。勿运行。
# [fork-only] DeskFox updater manifest 一站式发布(macOS)
# [feat: 启用自动升级] 2026-06-06 — /ship 步骤 7.5
#
# 把 build 产的 updater 产物(.app.tar.gz + .sig)发布成「自动升级源」,让已装旧版检测到新版:
#   ① 上传 .app.tar.gz 到阿里云 OSS(CDN dl.clawtray.com)拿稳定下载 URL
#   ② finalize-latest-json.ts 生成 Tauri updater 格式 latest.json(platforms.darwin-aarch64[-app])
#   ③ SCP 部署到 updates.deskfox.ai 对应 channel 的 darwin/latest.json
#   ④ HTTPS 回读校验线上 manifest == 刚发布版本
#
# 前置:
#   - 完整 build 已产 bundle/macos/*.app.tar.gz + .sig(完整 build + bridge-electron-updater.sh minisign 签;需 prod source config.env 的私钥)
#   - source ~/.deskfox-signing/config.env(OSS_ACCESS_KEY_ID/SECRET)
#   - SSH 密钥 ~/.ssh/lightsail-tokyo-ap-northeast-1.pem(东京 updates.deskfox.ai)
#
# 用法:
#   bash packages/branding/scripts/deploy-updater-manifest.sh --env prod --version 2026.6.0
#   bash packages/branding/scripts/deploy-updater-manifest.sh --env dev  --version 2026.6.0 --dry-run
#
# --dry-run:不真上传 OSS / 不真 SCP,只生成 latest.json 到 /tmp + 打印将执行的命令(安全预演,不碰线上)。

set -e

ENV="prod"
VERSION=""
DRY_RUN=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        -Env|--env|-e) ENV="$2"; shift 2 ;;
        --version|-v)  VERSION="$2"; shift 2 ;;
        --dry-run)     DRY_RUN=1; shift ;;
        *) echo "Unknown arg: $1" >&2; exit 1 ;;
    esac
done

if [[ -z "$VERSION" ]]; then echo "[updater] ERROR: --version 必传(例 2026.6.0)" >&2; exit 1; fi

# channel 映射(对齐服务器目录 + override endpoint {{target}})
case "$ENV" in
    prod) CHANNEL="desktop" ;;
    beta) CHANNEL="desktop-beta" ;;
    dev)  CHANNEL="desktop-dev" ;;
    *) echo "[updater] ERROR: --env 必须 prod|beta|dev;收到 $ENV" >&2; exit 1 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
MACOS_BUNDLE="$REPO_ROOT/packages/desktop/src-tauri/target/release/bundle/macos"
SSH_KEY="$HOME/.ssh/lightsail-tokyo-ap-northeast-1.pem"
SERVER="ubuntu@52.197.46.120"
REMOTE_DIR="/var/www/updates/v1/latest/$CHANNEL/darwin"
VERIFY_URL="https://updates.deskfox.ai/v1/latest/$CHANNEL/darwin/latest.json"

echo "[updater] === manifest 发布 env=$ENV channel=$CHANNEL version=$VERSION $([ $DRY_RUN -eq 1 ] && echo '(DRY-RUN)') ==="

# 1. 定位 updater 产物(.app.tar.gz + .sig)
TARBALL=$(ls "$MACOS_BUNDLE"/*.app.tar.gz 2>/dev/null | grep -v "Dev.app" | head -1 || true)
[[ -z "$TARBALL" ]] && TARBALL=$(ls "$MACOS_BUNDLE"/*.app.tar.gz 2>/dev/null | head -1 || true)
if [[ -z "$TARBALL" || ! -f "$TARBALL" ]]; then
    echo "[updater] ERROR: bundle/macos 下无 *.app.tar.gz — 先跑完整 build + bridge-electron-updater.sh 产 updater 产物" >&2
    exit 1
fi
SIG="$TARBALL.sig"
if [[ ! -f "$SIG" ]]; then
    echo "[updater] ERROR: 缺 .sig:$SIG — updater 无法验签(检查 TAURI_SIGNING_PRIVATE_KEY)" >&2
    exit 1
fi
echo "[updater] 产物: $(basename "$TARBALL") ($(stat -f%z "$TARBALL" 2>/dev/null || echo '?') bytes) + .sig"

# OSS 对象名(纯 ASCII + 版本,稳定可下载)
OBJ="DeskFox-${VERSION}-darwin.app.tar.gz"

# 2. 上传 .app.tar.gz 到 OSS(updater 从此 URL 下载升级包)
if [[ "$DRY_RUN" -eq 1 ]]; then
    OSS_URL="https://dl.clawtray.com/$OBJ"
    echo "[updater] (dry-run) 将上传: upload-asset-to-oss.sh --asset $TARBALL --name $OBJ"
    echo "[updater] (dry-run) 预期 URL: $OSS_URL"
else
    echo "[updater] 上传 .app.tar.gz 到 OSS ..."
    OSS_LOG=$(mktemp /tmp/deskfox-updater-oss-XXXXXX)  # X 必须结尾(BSD mktemp 只替换结尾 X;带 .log 后缀会 File exists)
    bash "$SCRIPT_DIR/upload-asset-to-oss.sh" --asset "$TARBALL" --name "$OBJ" 2>&1 | tee "$OSS_LOG"
    OSS_URL=$(grep '^OSS_DOWNLOAD_URL=' "$OSS_LOG" | tail -1 | cut -d= -f2-)
    if [[ -z "$OSS_URL" ]]; then echo "[updater] ERROR: OSS 上传未返回 URL(见 $OSS_LOG)" >&2; exit 1; fi
    echo "[updater] OSS URL: $OSS_URL"
fi

# 3. 生成 latest.json(Tauri updater 格式;pub-date 用当前 UTC)
PUB_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
OUT_DIR="/tmp/deskfox-updater-$ENV-darwin"
echo "[updater] 生成 latest.json (pub_date=$PUB_DATE) ..."
bun run "$REPO_ROOT/packages/branding/scripts/finalize-latest-json.ts" \
    --target darwin \
    --version "$VERSION" \
    --url "$OSS_URL" \
    --sig "$SIG" \
    --pub-date "$PUB_DATE" \
    --notes "DeskFox $VERSION (macOS) — 自动升级" \
    --out "$OUT_DIR"
MANIFEST="$OUT_DIR/latest.json"
echo "[updater] manifest 内容:"
cat "$MANIFEST"
echo ""

# 4. 部署到 updates.deskfox.ai + 回读校验
if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[updater] (dry-run) 将部署: scp -i $SSH_KEY $MANIFEST $SERVER:$REMOTE_DIR/latest.json"
    echo "[updater] (dry-run) 将校验: curl $VERIFY_URL"
    echo "[updater] ✅ dry-run 完成(未碰线上;manifest 已生成在 $MANIFEST)"
    exit 0
fi

echo "[updater] 部署到 $SERVER:$REMOTE_DIR/latest.json ..."
# /var/www/updates 属 www-data,ubuntu 无直接写权限 → 先 SCP 到 /tmp,再 sudo cp + chown(ubuntu sudo 免密)
TMP_REMOTE="/tmp/deskfox-latest-${CHANNEL}-darwin.json"
scp -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 \
    "$MANIFEST" "$SERVER:$TMP_REMOTE"
ssh -i "$SSH_KEY" -o ConnectTimeout=20 "$SERVER" \
    "sudo cp '$TMP_REMOTE' '$REMOTE_DIR/latest.json' && sudo chown www-data:www-data '$REMOTE_DIR/latest.json' && sudo chmod 644 '$REMOTE_DIR/latest.json' && rm -f '$TMP_REMOTE'"

echo "[updater] 回读校验线上 manifest ..."
sleep 2
ONLINE_VER=$(curl -s "$VERIFY_URL" | grep -oE '"version"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*"version"[^"]*"([^"]*)".*/\1/')
if [[ "$ONLINE_VER" == "$VERSION" ]]; then
    echo "[updater] ✅ 线上 manifest version=$ONLINE_VER == 发布版本,部署成功"
    echo "[updater] 升级源生效: $VERIFY_URL"
else
    echo "[updater] ⚠️  线上 version=$ONLINE_VER != 发布 $VERSION — 检查 nginx 缓存/CDN/路径" >&2
    exit 1
fi
