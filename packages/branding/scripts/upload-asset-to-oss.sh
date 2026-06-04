#!/usr/bin/env bash
# DeskFox release 安装包上传到阿里云 OSS（dl.clawtray.com CDN 国内镜像源）
#
# 背景：安装包内嵌 LibreOffice 后 .dmg 已 ~274MB，远超 Gitee 100MB 单文件上限，
# Gitee 附件方案失效。国内镜像改走阿里云 OSS bucket（CDN 域名 dl.clawtray.com）：
#   ① 本脚本把 .dmg 传到 oss://<bucket>/<文件名>
#   ② 访问地址 https://dl.clawtray.com/<文件名>（官网 update-version.ps1 已优先用此 CDN）
#   ③ ship 流程随后把这个下载链接写进 Gitee release 正文（不再往 Gitee 传文件）
#
# 凭据来源（绝不硬编码进开源仓）：source ~/.deskfox-signing/config.env 后读环境变量
#   OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET   必填
#   OSS_ENDPOINT      默认 oss-rg-china-mainland.aliyuncs.com
#   OSS_BUCKET        默认 downloadbot
#   OSS_CDN_BASE      默认 https://dl.clawtray.com
#
# 用法：
#   source ~/.deskfox-signing/config.env
#   bash packages/branding/scripts/upload-asset-to-oss.sh ship-mac-prod-2026.6.3.1
#   # 或手动指定文件：
#   bash packages/branding/scripts/upload-asset-to-oss.sh --asset path/to/DeskFox-x_aarch64.dmg
#
# 成功后 stdout 末行打印机器可解析的：OSS_DOWNLOAD_URL=https://dl.clawtray.com/<文件名>
#
# 参数：
#   位置参数 1: tag，例 ship-mac-prod-2026.6.3.1（自动定位本地 .dmg）
#   --asset <path>   手动指定上传文件路径
#   --name <name>    上传到 OSS 用的对象名（默认 = 文件 basename）
#   --bucket <b>     覆盖 OSS_BUCKET
#   --no-verify      跳过 CDN HEAD 验证（CDN 缓存刷新有延迟时用）

set -euo pipefail

# ─── color codes ────────────────────────────────────────────────────
RED='\033[31m'; GREEN='\033[32m'; YELLOW='\033[33m'; RESET='\033[0m'

# ─── default args / env ─────────────────────────────────────────────
TAG=""
ASSET=""
OBJECT_NAME=""
NO_VERIFY=0
OSS_ENDPOINT="${OSS_ENDPOINT:-oss-rg-china-mainland.aliyuncs.com}"
OSS_BUCKET="${OSS_BUCKET:-downloadbot}"
OSS_CDN_BASE="${OSS_CDN_BASE:-https://dl.clawtray.com}"
OSS_CDN_BASE="${OSS_CDN_BASE%/}"   # strip trailing slash

# ossutil 装到 ExtSSD（内置盘空间不足，全部装外置盘）
OSSUTIL_DIR="${OSSUTIL_DIR:-/Volumes/ExtSSD/.ossutil}"
OSSUTIL_VER="1.7.19"

# ─── parse args ────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --asset)     ASSET="$2"; shift 2 ;;
    --name)      OBJECT_NAME="$2"; shift 2 ;;
    --bucket)    OSS_BUCKET="$2"; shift 2 ;;
    --no-verify) NO_VERIFY=1; shift ;;
    -h|--help)   grep -E '^# ' "$0" | head -30; exit 0 ;;
    -*)          echo -e "${RED}[ERROR] 未知参数：$1${RESET}" >&2; exit 1 ;;
    *)
      if [[ -z "$TAG" ]]; then TAG="$1"
      else echo -e "${RED}[ERROR] 多余位置参数：$1（已有 tag=$TAG）${RESET}" >&2; exit 1; fi
      shift ;;
  esac
done

# ─── 1. 校验凭据 ───────────────────────────────────────────────────
if [[ -z "${OSS_ACCESS_KEY_ID:-}" || -z "${OSS_ACCESS_KEY_SECRET:-}" ]]; then
  echo -e "${RED}[ERROR] 缺 OSS 凭据。先 source ~/.deskfox-signing/config.env${RESET}" >&2
  echo "  config.env 需含：OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET（可选 OSS_ENDPOINT / OSS_BUCKET / OSS_CDN_BASE）" >&2
  exit 1
fi

# ─── 2. 自动定位 asset（复用 mirror-asset-to-gitee.sh 的 tag→路径规则）────
if [[ -z "$ASSET" ]]; then
  if [[ -z "$TAG" ]]; then
    echo -e "${RED}[ERROR] 既没给 tag 也没给 --asset${RESET}" >&2; exit 1
  fi
  if [[ "$TAG" =~ ^ship-mac-(prod|beta|dev)-(.+)$ ]]; then
    ENV_NAME="${BASH_REMATCH[1]}"
    VERSION="${BASH_REMATCH[2]}"
  elif [[ "$TAG" =~ ^ship-(prod|beta|dev)-(.+)$ ]]; then
    echo -e "${RED}[ERROR] tag '$TAG' 是 Win release（无 mac 前缀），本脚本只处理 Mac${RESET}" >&2; exit 1
  else
    echo -e "${RED}[ERROR] 无法从 tag '$TAG' 推 env/version，请用 --asset 手动指定${RESET}" >&2; exit 1
  fi
  # NumericVer = strip env suffix（对齐 pack-installer.sh 的 .dmg rename）
  NUMERIC_VERSION=$(echo "$VERSION" | sed -E 's/-(dev|beta)$//')
  PRODUCT_PREFIX="DeskFox"
  [[ "$ENV_NAME" == "beta" ]] && PRODUCT_PREFIX="DeskFox-Beta"
  [[ "$ENV_NAME" == "dev" ]]  && PRODUCT_PREFIX="DeskFox-Dev"
  CANDIDATE="packages/desktop/src-tauri/target/release/bundle/dmg/${PRODUCT_PREFIX}-${NUMERIC_VERSION}_aarch64.dmg"
  if [[ ! -f "$CANDIDATE" ]]; then
    echo -e "${YELLOW}[INFO] 本地未发现 $CANDIDATE，尝试从 GitHub Release 下载...${RESET}"
    TMP_DIR="/tmp/oss-upload-$TAG"; mkdir -p "$TMP_DIR"
    if ! command -v gh >/dev/null 2>&1; then
      echo -e "${RED}[ERROR] gh CLI 未找到。装：brew install gh && gh auth login${RESET}" >&2; exit 1
    fi
    gh release download "$TAG" --repo "zoulukuang/deskfox" --dir "$TMP_DIR" --clobber --pattern "*.dmg" 2>&1 | head -20
    CANDIDATE=$(find "$TMP_DIR" -name "*.dmg" -type f | head -n1)
    [[ -z "$CANDIDATE" || ! -f "$CANDIDATE" ]] && { echo -e "${RED}[ERROR] GitHub Release 没找到 .dmg${RESET}" >&2; exit 1; }
  fi
  ASSET="$CANDIDATE"
fi

[[ ! -f "$ASSET" ]] && { echo -e "${RED}[ERROR] 找不到 asset 文件：$ASSET${RESET}" >&2; exit 1; }

[[ -z "$OBJECT_NAME" ]] && OBJECT_NAME=$(basename "$ASSET")
# OSS / CDN 文件名必须英文数字、无空格中文（alibaba-cdn.md 约束）
if [[ "$OBJECT_NAME" =~ [[:space:]] || "$OBJECT_NAME" =~ [^[:print:]] ]]; then
  echo -e "${RED}[ERROR] 对象名含空格/非 ASCII：$OBJECT_NAME — 改用 --name 指定纯英文数字名${RESET}" >&2; exit 1
fi

ASSET_SIZE=$(stat -f%z "$ASSET" 2>/dev/null || stat -c%s "$ASSET" 2>/dev/null || wc -c < "$ASSET" | tr -d ' ')
ASSET_SIZE_MB=$(awk "BEGIN { printf \"%.2f\", $ASSET_SIZE / 1048576 }")
echo "[asset] $(basename "$ASSET") (${ASSET_SIZE_MB} MB) → oss://$OSS_BUCKET/$OBJECT_NAME"

# ─── 3. 准备 ossutil（不存在则下载到 ExtSSD）─────────────────────────
# 优先用 PATH 里已有的 ossutil；否则用/下载本地副本
OSSUTIL_BIN=""
for c in ossutil ossutilmac64 ossutil64; do
  if command -v "$c" >/dev/null 2>&1; then OSSUTIL_BIN=$(command -v "$c"); break; fi
done
if [[ -z "$OSSUTIL_BIN" ]]; then
  OSSUTIL_BIN="$OSSUTIL_DIR/ossutilmac64"
  if [[ ! -x "$OSSUTIL_BIN" ]]; then
    echo -e "${YELLOW}[INFO] 未发现 ossutil，下载 v$OSSUTIL_VER 到 $OSSUTIL_DIR ...${RESET}"
    mkdir -p "$OSSUTIL_DIR"
    # Apple Silicon 用 arm64 包；下载失败回退 x86_64（Rosetta 可跑）
    ARCH=$(uname -m)
    if [[ "$ARCH" == "arm64" ]]; then
      DL="https://gosspublic.alicdn.com/ossutil/${OSSUTIL_VER}/ossutilmac-arm64"
    else
      DL="https://gosspublic.alicdn.com/ossutil/${OSSUTIL_VER}/ossutilmac64"
    fi
    if ! curl -fsSL "$DL" -o "$OSSUTIL_BIN"; then
      echo -e "${YELLOW}[INFO] arm64 包下载失败，回退 x86_64...${RESET}"
      curl -fsSL "https://gosspublic.alicdn.com/ossutil/${OSSUTIL_VER}/ossutilmac64" -o "$OSSUTIL_BIN" \
        || { echo -e "${RED}[ERROR] ossutil 下载失败${RESET}" >&2; exit 1; }
    fi
    chmod +x "$OSSUTIL_BIN"
  fi
fi
echo "[ossutil] $OSSUTIL_BIN"

# ─── 4. 上传（--force 覆盖同名；大文件自动分片+断点续传）──────────────
echo "[upload] 上传到 oss://$OSS_BUCKET/$OBJECT_NAME ..."
START_TIME=$(date +%s)
set +e
"$OSSUTIL_BIN" cp "$ASSET" "oss://$OSS_BUCKET/$OBJECT_NAME" \
  -e "$OSS_ENDPOINT" \
  -i "$OSS_ACCESS_KEY_ID" \
  -k "$OSS_ACCESS_KEY_SECRET" \
  --force 2>&1 | tail -8
UP_RC=${PIPESTATUS[0]}
set -e
END_TIME=$(date +%s); ELAPSED=$((END_TIME - START_TIME)); [[ "$ELAPSED" -lt 1 ]] && ELAPSED=1
SPEED_MBPS=$(awk "BEGIN { printf \"%.2f\", $ASSET_SIZE_MB / $ELAPSED * 8 }")
if [[ "$UP_RC" -ne 0 ]]; then
  echo -e "${RED}❌ ossutil 上传失败（rc=$UP_RC）${RESET}" >&2; exit 1
fi
echo "[upload done] elapsed=${ELAPSED}s (${SPEED_MBPS} Mbps)"

DOWNLOAD_URL="$OSS_CDN_BASE/$OBJECT_NAME"

# ─── 5. CDN HEAD 验证 ──────────────────────────────────────────────
if [[ "$NO_VERIFY" -eq 0 ]]; then
  echo "[verify] HEAD $DOWNLOAD_URL ..."
  # CDN 缓存回源有几秒延迟，重试几次
  ok=0
  for i in 1 2 3 4 5; do
    code=$(curl -s -o /dev/null -w "%{http_code}" -I --connect-timeout 20 --max-time 60 "$DOWNLOAD_URL" || echo "000")
    if [[ "$code" == "200" ]]; then ok=1; break; fi
    echo "      第 $i 次 HEAD=$code，2s 后重试..."; sleep 2
  done
  if [[ "$ok" -ne 1 ]]; then
    echo -e "${YELLOW}⚠️  CDN HEAD 未返回 200（可能缓存未刷新）。OSS 已上传成功，链接稍后可访问。${RESET}" >&2
    echo "    如长时间 404，到阿里云 CDN 控制台刷新 $DOWNLOAD_URL 缓存。" >&2
  else
    echo -e "${GREEN}[OK] CDN 可访问（HEAD 200）${RESET}"
  fi
fi

echo ""
echo -e "${GREEN}✅ 上传成功！${RESET}"
echo "下载地址：$DOWNLOAD_URL"
# 机器可解析行（ship 流程 grep 这行取 URL）
echo "OSS_DOWNLOAD_URL=$DOWNLOAD_URL"
