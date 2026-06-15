#!/usr/bin/env bash
# [fork-only] Tauri→Electron mac 升级桥(bridge-electron-updater.ps1 的 macOS 版)
# [feat: electron-macos-updater-bridge] 2026-06-15
#
# 背景:老 Tauri mac 用户的更新器查老端点 v1/latest/<channel>/darwin/latest.json(Tauri minisign 格式,
#   下载 .app.tar.gz 验签后就地替换 .app);新 Electron 用 electron-updater 查 .../electron/<ch>/latest-mac.yml。
#   两链互不相见 → 不搭桥老 Tauri 用户永远收不到 Electron 版。本脚本产「摆渡 manifest」让其迁移。
#
# 做什么:
#   ① 把 Electron .app 打成 .app.tar.gz —— 🔴 COPYFILE_DISABLE=1(防 AppleDouble ._ 成员致老 Tauri
#      install_inner 解压第 0 entry EPERM 静默失败,2026-06-12 线上事故根因)+ python3 断言无 ._ 成员
#   ② minisign 用 Tauri 私钥签 tarball(默认 ED 预哈希,已验 Tauri 兼容);.sig = base64(.minisig)
#   ③ finalize-latest-json.ts 生成 Tauri 格式 latest.json(platforms.darwin-aarch64[-app])
#   ④ --deploy:上传 tarball 到 OSS + SCP latest.json 到老 darwin 端点 + 回读校验
#
# 🔴 版本号坑:--version 必须 > 已发最高 Tauri mac 版(老 Tauri 用日历号 YYYY.M.D)。填 Electron semver
#   (1.17.x)会被老 Tauri 判降级不推送。首段 < 2000 的会被脚本拦下。
#
# 用法:
#   bash bridge-electron-updater.sh --app "<Electron.app>" --version 2026.12.1 --env dev --dry-run
#   bash bridge-electron-updater.sh --app "<Electron.app>" --version 2026.12.1 --env dev --deploy
# 前置:source ~/.deskfox-signing/config.env(TAURI_SIGNING_PRIVATE_KEY[_PASSWORD] + OSS_*);minisign 已装。
# 注:--app 应是【签名+公证好】的 Electron .app(迁移后用户拿到的就是它);dev 验证可用未签名 .app 测桥机制。

set -euo pipefail

APP=""; VERSION=""; ENV="prod"; DEPLOY=0; DRY_RUN=0; OUT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --app|-a)      APP="$2"; shift 2 ;;
    --version|-v)  VERSION="$2"; shift 2 ;;
    -Env|--env|-e) ENV="$2"; shift 2 ;;
    --out|-o)      OUT="$2"; shift 2 ;;
    --deploy)      DEPLOY=1; shift ;;
    --dry-run)     DRY_RUN=1; shift ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done
[[ -z "$APP" || ! -d "$APP" ]] && { echo "[bridge] ERROR: --app 须是存在的 .app 目录(得 '$APP')" >&2; exit 1; }
[[ -z "$VERSION" ]] && { echo "[bridge] ERROR: --version 必传(老 Tauri 日历号,> 最高已发 Tauri mac 版,如 2026.12.1)" >&2; exit 1; }
case "$ENV" in dev|beta|prod) ;; *) echo "[bridge] ERROR: --env 须 dev|beta|prod" >&2; exit 1 ;; esac

# 🔴 版本号防呆:老 Tauri 日历版首段是年份(>=2000);< 2000 几乎肯定误填了 Electron semver(1.17.x)→ 判降级
FIRST_SEG="${VERSION%%[.-]*}"
if ! [[ "$FIRST_SEG" =~ ^[0-9]+$ ]] || [[ "$FIRST_SEG" -lt 2000 ]]; then
  echo "[bridge] ERROR: --version '$VERSION' 首段 < 2000,像是 Electron semver。老 Tauri 用日历号 YYYY.M.D," >&2
  echo "                会把它判成降级不推送。请填 > 最高已发 Tauri mac 版的日历号(如 2026.12.1)。" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
[[ -z "$OUT" ]] && OUT="/tmp/deskfox-bridge-mac-$ENV"
rm -rf "$OUT"; mkdir -p "$OUT"
case "$ENV" in prod) CHANNEL="desktop" ;; beta) CHANNEL="desktop-beta" ;; dev) CHANNEL="desktop-dev" ;; esac
SERVER="ubuntu@52.197.46.120"
REMOTE_DIR="/var/www/updates/v1/latest/$CHANNEL/darwin"
VERIFY_URL="https://updates.deskfox.ai/v1/latest/$CHANNEL/darwin/latest.json"
OSS_CDN_BASE="https://dl.clawtray.com"
OBJ="DeskFox-${VERSION}-darwin.app.tar.gz"
OSS_URL="$OSS_CDN_BASE/$OBJ"
SSH_KEY="${SSH_KEY:-}"
[[ -z "$SSH_KEY" ]] && for k in "$HOME/.ssh/lightsail-tokyo-ap-northeast-1.pem" "$HOME/.ssh/LightsailDefaultKey-ap-northeast-1.pem"; do [[ -f "$k" ]] && { SSH_KEY="$k"; break; }; done

echo "[bridge] === Tauri→Electron mac 桥 env=$ENV channel=$CHANNEL version=$VERSION $([ $DRY_RUN -eq 1 ] && echo '(DRY-RUN)') ==="
echo "[bridge] app=$APP  out=$OUT  老端点=$VERIFY_URL"

# 1. tar .app.tar.gz —— 🔴 COPYFILE_DISABLE=1 禁 AppleDouble
TARBALL="$OUT/$OBJ"
APP_PARENT="$(cd "$(dirname "$APP")" && pwd)"; APP_NAME="$(basename "$APP")"
echo "[bridge] tar .app.tar.gz(COPYFILE_DISABLE=1)…"
( cd "$APP_PARENT" && COPYFILE_DISABLE=1 tar -czf "$TARBALL" "$APP_NAME" )

# 2. python3 断言无 AppleDouble ._ 成员(bsdtar/tar tzf 会隐藏 ._,必须 python3 tarfile 暴露 raw 成员)
echo "[bridge] 校验 tarball 无 AppleDouble ._ 成员…"
python3 - "$TARBALL" <<'PY'
import tarfile, sys
names = tarfile.open(sys.argv[1]).getnames()
bad = [n for n in names if n.startswith("._") or "/._" in n]
if bad:
    print("[bridge] ❌ tarball 含 %d 个 AppleDouble ._ 成员(会致老 Tauri 解压 EPERM),前 5:" % len(bad))
    print("   " + "\n   ".join(bad[:5])); sys.exit(1)
print("[bridge]   ✓ %d 个成员,0 个 ._(AppleDouble 干净)" % len(names))
PY

# 3. minisign 签(Tauri 私钥;默认 ED 预哈希,已验 Tauri 兼容)→ .sig = base64(.minisig)
echo "[bridge] minisign 签 tarball(Tauri 私钥;不回显密钥/密码)…"
set +u; source "$HOME/.deskfox-signing/config.env" >/dev/null 2>&1; set -u
[[ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]] || { echo "[bridge] ❌ 无 TAURI_SIGNING_PRIVATE_KEY(查 config.env)" >&2; exit 1; }
KEYFILE="$OUT/.deskfox.key"
printf '%s' "$TAURI_SIGNING_PRIVATE_KEY" | tr -d '\r\n' | base64 -d > "$KEYFILE" 2>/dev/null
MINISIG="$TARBALL.minisig"
printf '%s\n' "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" | minisign -S -s "$KEYFILE" -m "$TARBALL" -x "$MINISIG" >/dev/null 2>&1 \
  || { echo "[bridge] ❌ minisign 签名失败" >&2; rm -f "$KEYFILE"; exit 1; }
rm -f "$KEYFILE"
SIG_FILE="$TARBALL.sig"
base64 -i "$MINISIG" | tr -d '\n' > "$SIG_FILE"          # Tauri .sig = base64(.minisig 全文)
echo "[bridge]   ✓ 签名:$SIG_FILE($(wc -c < "$SIG_FILE") chars)"

# 4. 生成 Tauri 格式 latest.json(指向 OSS 上的 tarball)
PUB_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "[bridge] finalize-latest-json.ts --target darwin …"
bun run "$SCRIPT_DIR/finalize-latest-json.ts" \
  --target darwin --version "$VERSION" --url "$OSS_URL" --sig "$SIG_FILE" --pub-date "$PUB_DATE" --out "$OUT" >/dev/null
MANIFEST="$OUT/latest.json"
[[ -f "$MANIFEST" ]] || { echo "[bridge] ❌ finalize 未产出 latest.json" >&2; exit 1; }
echo "[bridge] 摆渡 latest.json:"; echo "----------"; cat "$MANIFEST"; echo "----------"

# 5. 部署(--deploy):OSS 传 tarball + SCP latest.json 到老 darwin 端点 + 回读
if [[ "$DEPLOY" -eq 0 ]]; then
  echo "[bridge] ✅ 产物就绪(未 --deploy):tarball=$TARBALL / sig=$SIG_FILE / manifest=$MANIFEST"
  echo "[bridge]    部署需 --deploy;老 Tauri mac 用户下次查更新即下载该 Electron 包验签升级。"
  exit 0
fi
upload_oss() {
  if [[ "$DRY_RUN" -eq 1 ]]; then echo "[bridge] (dry-run) 将上传: upload-asset-to-oss.sh --asset $1 --name $2 → $OSS_CDN_BASE/$2"
  else bash "$SCRIPT_DIR/upload-asset-to-oss.sh" --asset "$1" --name "$2" 2>&1 | tail -3; fi
}
upload_oss "$TARBALL" "$OBJ"
TMP_REMOTE="/tmp/deskfox-bridge-${CHANNEL}-darwin-latest.json"
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[bridge] (dry-run) 将 SCP: scp -i $SSH_KEY $MANIFEST $SERVER:$TMP_REMOTE"
  echo "[bridge] (dry-run) 将远端: sudo cp $TMP_REMOTE $REMOTE_DIR/latest.json + chown www-data + chmod 644"
  echo "[bridge] (dry-run) 将校验: curl $VERIFY_URL"
  echo "[bridge] ✅ dry-run 完成(0 碰线上)"
else
  [[ -z "$SSH_KEY" ]] && { echo "[bridge] ❌ 无 SSH key,无法部署" >&2; exit 1; }
  scp -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 "$MANIFEST" "$SERVER:$TMP_REMOTE"
  ssh -i "$SSH_KEY" -o ConnectTimeout=20 "$SERVER" \
    "sudo mkdir -p '$REMOTE_DIR' && sudo cp '$TMP_REMOTE' '$REMOTE_DIR/latest.json' && sudo chown www-data:www-data '$REMOTE_DIR/latest.json' && sudo chmod 644 '$REMOTE_DIR/latest.json' && rm -f '$TMP_REMOTE'"
  echo "[bridge] 回读校验线上 latest.json …"; sleep 2
  ONLINE_VER=$(curl -s "$VERIFY_URL" | grep -oE '"version" *: *"[^"]+"' | head -1 | sed -E 's/.*"version" *: *"([^"]+)".*/\1/')
  [[ "$ONLINE_VER" == "$VERSION" ]] && echo "[bridge] ✅ 线上 version=$ONLINE_VER == 发布,桥生效: $VERIFY_URL" \
    || { echo "[bridge] ⚠️ 线上 version=$ONLINE_VER != $VERSION — 检查 nginx 缓存/CDN/路径" >&2; exit 1; }
fi
