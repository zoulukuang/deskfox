#!/usr/bin/env bash
# [fork-only] DeskFox **Electron** updater manifest 一站式发布(Win + macOS 双平台)
# [feat: electron-replatform(win)/ electron-macos-updater-bridge(mac 扩展)] 2026-06-15
#
# 平台(--platform mac|win,缺省按本机 uname):
#   win → latest.yml + DeskFox*-<ver>-win-x64.exe(NSIS)
#   mac → latest-mac.yml + DeskFox*-<ver>-mac-arm64.zip(electron-updater 用)+ .dmg(用户面)
#
# 背景:换基座到 Electron 后,自动升级从 Tauri(latest.json + .app.tar.gz + minisign)切到
#   electron-updater(generic provider:latest.yml + sha512 内嵌)。deskfox config 的 publish.url =
#   https://updates.deskfox.ai/electron/<channel>。本脚本补齐**之前缺失的 Electron 部署编排**
#   (Tauri 的 deploy-updater-manifest.sh 不适用:它发 darwin/.app.tar.gz/latest.json 到 v1/latest/<ch>/darwin)。
#
# 做什么(对齐 Tauri 脚本的服务器/OSS 机制,改 Electron 格式 + 路径):
#   ① 上传 NSIS(+.blockmap)到阿里云 OSS(CDN dl.clawtray.com)拿稳定下载 URL
#   ② 改 electron-builder 产的 latest.yml:把 files[].url / path 从相对文件名 → OSS 绝对 URL
#      (generic provider 读到绝对 url 就从 CDN 下;manifest 本身只放更新服务器,资产走 CDN)
#   ③ SCP latest.yml 到 updates.deskfox.ai 的 /var/www/updates/electron/<channel>/latest.yml
#   ④ HTTPS 回读校验线上 latest.yml version == 本次版本
#   ⑤ (可选)Gitee 镜像 NSIS,挂国内备用下载
#
# 前置:
#   - 已**完整 build**(非 --no-bundle)出 dist-deskfox 下对应平台资产 + latest[-mac].yml(electron-builder 自动产)
#   - source ~/.deskfox-signing/config.env(OSS_ACCESS_KEY_ID/SECRET)
#   - SSH key:$SSH_KEY 或 ~/.ssh/lightsail-tokyo-*.pem 或 ~/.ssh/LightsailDefaultKey-*.pem(同一台东京 lightsail)
#
# 用法:
#   bash .../deploy-electron-updater.sh --platform mac --env dev --version 2026.6.0 --dry-run   # mac 预演
#   bash .../deploy-electron-updater.sh --platform mac --env dev --version 2026.6.0             # mac 真部署
#   bash .../deploy-electron-updater.sh --platform win --env beta --version 2026.8.0            # win(原行为)
#   选项:--platform mac|win(缺省按 uname);--no-gitee 跳过 Gitee;--asset <path> 指定单资产(默认自动找)
#
# --dry-run:不传 OSS / 不 SCP / 不 Gitee,只生成改好的 YML 到 /tmp + 打印将执行的命令(安全预演,0 碰线上)。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
DIST_DIR="$REPO_ROOT/packages/desktop/dist-deskfox"

# 自加载密钥(OSS 凭据 / 签名私钥)—— set -a 让赋值自动 export,子进程(upload-asset-to-oss.sh)继承。
# 健壮性:不再依赖调用方先 `source config.env`;config.env 需含 OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET。
if [[ -f "$HOME/.deskfox-signing/config.env" ]]; then
  set -a; source "$HOME/.deskfox-signing/config.env"; set +a
fi

ENV="beta"; VERSION=""; DRY_RUN=0; NO_GITEE=0; ASSET=""; PLATFORM=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -Env|--env|-e) ENV="$2"; shift 2 ;;
    --version|-v)  VERSION="$2"; shift 2 ;;
    --asset)       ASSET="$2"; shift 2 ;;
    --platform|-p) PLATFORM="$2"; shift 2 ;;   # mac|win;缺省按本机 uname
    --dry-run)     DRY_RUN=1; shift ;;
    --no-gitee)    NO_GITEE=1; shift ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done
[[ -z "$VERSION" ]] && { echo "[el-updater] ERROR: --version 必传(例 2026.8.0)" >&2; exit 1; }
case "$ENV" in dev|beta|prod) ;; *) echo "[el-updater] ERROR: --env 须 dev|beta|prod" >&2; exit 1 ;; esac

# 平台解析(缺省按本机 uname):mac → latest-mac.yml + .zip/.dmg;win → latest.yml + .exe
[[ -z "$PLATFORM" ]] && case "$(uname -s)" in Darwin) PLATFORM=mac ;; *) PLATFORM=win ;; esac
case "$PLATFORM" in
  mac) YML_NAME="latest-mac.yml" ;;
  win) YML_NAME="latest.yml" ;;
  *) echo "[el-updater] ERROR: --platform 须 mac|win(得 $PLATFORM)" >&2; exit 1 ;;
esac

# 服务器(同 Tauri 那台东京 lightsail)+ Electron 专用路径
# 🔴 用**域名**做 SSH host(不写死 IP):updates.deskfox.ai 换机器/换弹性 IP 时 DNS 自动跟随,
#    脚本无需改。历史坑(2026-07-08):曾硬编码旧 IP 52.197.46.120,服务器换 IP 后 SSH 22 静默超时,
#    OSS 产物传成功但 manifest SCP 失败 → 更新源不刷 → 用户照不到新版。紧急可 DESKFOX_UPDATE_SSH 覆盖。
SERVER="${DESKFOX_UPDATE_SSH:-ubuntu@updates.deskfox.ai}"
REMOTE_DIR="/var/www/updates/electron/$ENV"
VERIFY_URL="https://updates.deskfox.ai/electron/$ENV/$YML_NAME"
OSS_CDN_BASE="https://dl.clawtray.com"
# SSH key 探测(Mac/Win 文件名不同)
SSH_KEY="${SSH_KEY:-}"
if [[ -z "$SSH_KEY" ]]; then
  for k in "$HOME/.ssh/lightsail-tokyo-ap-northeast-1.pem" "$HOME/.ssh/LightsailDefaultKey-ap-northeast-1.pem"; do
    [[ -f "$k" ]] && { SSH_KEY="$k"; break; }
  done
fi

echo "[el-updater] === Electron updater 发布 env=$ENV version=$VERSION $([ $DRY_RUN -eq 1 ] && echo '(DRY-RUN)') ==="
echo "[el-updater] server=$SERVER  remote=$REMOTE_DIR  verify=$VERIFY_URL"
echo "[el-updater] ssh-key=${SSH_KEY:-<未找到>}"

# 1. 定位资产 + YML(electron-builder 产物)。win 单 exe;mac zip(updater 用)+ dmg(用户面)。
YML="$DIST_DIR/$YML_NAME"
[[ ! -f "$YML" ]] && { echo "[el-updater] ERROR: 缺 $YML_NAME($YML)— electron-builder 应自动产(完整 bundle 构建,非 --no-bundle)" >&2; exit 1; }
ASSETS=()
if [[ -n "$ASSET" ]]; then
  ASSETS+=("$ASSET")
elif [[ "$PLATFORM" == "mac" ]]; then
  # REQ-081:mac 双 arch —— arm64 与 x64 的 zip(updater 用)+ dmg(用户面)全收,生成单本合并 yml。
  #   只 build 了一个 arch 时自然只收到那一个,退化为单 arch(向后兼容)。
  for f in "$DIST_DIR"/DeskFox*-"${VERSION}"-mac-arm64.zip "$DIST_DIR"/DeskFox*-"${VERSION}"-mac-arm64.dmg \
           "$DIST_DIR"/DeskFox*-"${VERSION}"-mac-x64.zip   "$DIST_DIR"/DeskFox*-"${VERSION}"-mac-x64.dmg; do
    [[ -f "$f" ]] && ASSETS+=("$f")
  done
else
  f=$(ls "$DIST_DIR"/DeskFox*-"${VERSION}"-win-x64.exe 2>/dev/null | grep -v blockmap | head -1 || true)
  [[ -n "$f" && -f "$f" ]] && ASSETS+=("$f")
fi
[[ ${#ASSETS[@]} -eq 0 ]] && { echo "[el-updater] ERROR: 找不到资产(dist-deskfox 下 DeskFox*-${VERSION}-${PLATFORM}-*)— 先完整 build" >&2; exit 1; }
# Gitee 镜像挑用户面安装包:mac 优先 arm64 .dmg(存量主力),否则任一 .dmg / win=.exe(无则退首个资产)
GITEE_ASSET="${ASSETS[0]}"
for a in "${ASSETS[@]}"; do case "$a" in *.dmg|*.exe) GITEE_ASSET="$a" ;; esac; done
for a in "${ASSETS[@]}"; do case "$a" in *-mac-arm64.dmg) GITEE_ASSET="$a" ;; esac; done

# 2. 生成/改写 YML → OUT_YML(url 全 OSS 绝对;sha512/size 一律磁盘实算,天然消 staple 脏数据)
OUT_YML="/tmp/deskfox-electron-${ENV}-${YML_NAME}"
if [[ "$PLATFORM" == "mac" ]]; then
  # REQ-081 mac 双 arch:electron-builder 每次 build 只产单 arch 的 latest-mac.yml、后一次覆盖前一次,
  #   拿不全两 arch。改由磁盘上全部 arch 资产【重新生成】一本合并 yml:arm64+x64 的 zip/dmg 全列进
  #   files[](electron-updater MacUpdater.filterFilesForArch 按 url 含不含 arm64 给每台机分流)。
  #   version/releaseDate 取自 electron-builder yml;sha512/size 磁盘实算(顺带根治 staple 脏数据);
  #   path/顶层 sha512 指 arm64 zip(存量用户 arm64,不读 files[] 的老客户端 fallback 默认给 arm64)。
  #   只 build 一个 arch 时自然退化为单 arch,向后兼容。
  python3 - "$YML" "$OUT_YML" "$OSS_CDN_BASE" "$VERSION" "${ASSETS[@]}" <<'PY'
import sys, re, base64, hashlib, os
src, out, cdn, version = sys.argv[1:5]
assets = sys.argv[5:]
rel = ""
for ln in open(src).read().split("\n"):
    m = re.match(r"^releaseDate: (.*)$", ln)
    if m: rel = m.group(1).strip()
def dig(p):
    h = hashlib.sha512()
    with open(p, "rb") as f:
        for c in iter(lambda: f.read(1 << 20), b""): h.update(c)
    return base64.b64encode(h.digest()).decode(), os.path.getsize(p)
# 排序:arm64 zip → arm64 dmg → x64 zip → x64 dmg(arm64 优先做 primary)
assets = sorted(assets, key=lambda p: (0 if "arm64" in os.path.basename(p) else 1,
                                       0 if os.path.basename(p).endswith(".zip") else 1))
lines, primary = ["version: " + version, "files:"], None
for a in assets:
    b = os.path.basename(a); sha, size = dig(a)
    lines += ["  - url: %s/%s" % (cdn, b), "    sha512: " + sha, "    size: " + str(size)]
    if primary is None and b.endswith(".zip"): primary = (b, sha)
if primary is None:
    b = os.path.basename(assets[0]); sha, _ = dig(assets[0]); primary = (b, sha)
lines += ["path: %s/%s" % (cdn, primary[0]), "sha512: " + primary[1]]
if rel: lines.append("releaseDate: " + rel)
open(out, "w").write("\n".join(lines) + "\n")
print("[el-updater] mac yml 已生成(双 arch files[]):", ", ".join(os.path.basename(a) for a in assets))
PY
else
  # win(单 exe,原行为):sed 把 url/path 改 OSS 绝对
  SED_ARGS=()
  for a in "${ASSETS[@]}"; do
    obj="$(basename "$a")"
    SED_ARGS+=(-e "s#(url|path): +${obj}\$#\1: ${OSS_CDN_BASE}/${obj}#")
  done
  sed -E "${SED_ARGS[@]}" "$YML" > "$OUT_YML"
  # 2.5 按磁盘实算回写 sha512/size(2026-07-08 立;win 无 staple 但统一路径、重算无害)
  python3 - "$OUT_YML" "${ASSETS[@]}" <<'PY'
import sys, re, base64, hashlib, os
yml, assets = sys.argv[1], sys.argv[2:]
info = {}
for a in assets:
    h = hashlib.sha512()
    with open(a, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    info[os.path.basename(a)] = (base64.b64encode(h.digest()).decode(), os.path.getsize(a))
out, cur = [], None
for ln in open(yml).read().split("\n"):
    m = re.match(r"^(\s*(?:- )?)(url|path): (?:https?://\S+/)?(\S+)\s*$", ln)
    if m:
        cur = info.get(m.group(3))
        out.append(ln)
        continue
    if cur:
        m2 = re.match(r"^(\s*)sha512: ", ln)
        if m2:
            out.append(m2.group(1) + "sha512: " + cur[0])
            continue
        m3 = re.match(r"^(\s*)size: ", ln)
        if m3:
            out.append(m3.group(1) + "size: " + str(cur[1]))
            cur = None
            continue
        cur = None  # 其他 key = 该资产条目结束
    out.append(ln)
open(yml, "w").write("\n".join(out))
print("[el-updater] 2.5 已按磁盘实算回写 sha512/size:", ", ".join(sorted(info)))
PY
fi

echo "[el-updater] 改写后 $YML_NAME($OUT_YML):"; echo "----------"; cat "$OUT_YML"; echo "----------"
# 自检:无残留相对文件名(url/path 全应改成 https 绝对),且 version 对
if grep -qE ': +DeskFox.*\.(zip|dmg|exe)$' "$OUT_YML"; then
  echo "[el-updater] ERROR: $YML_NAME 仍有未改写的相对 url/path(资产名与 yml 不匹配?)" >&2; exit 1
fi
grep -qE "^version: *${VERSION}\$" "$OUT_YML" || { echo "[el-updater] ERROR: $YML_NAME version != ${VERSION}" >&2; exit 1; }

# 3. 上传 OSS(每个资产 + .blockmap)
upload_oss() {
  local f="$1" name="$2"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[el-updater] (dry-run) 将上传: upload-asset-to-oss.sh --asset $f --name $name → $OSS_CDN_BASE/$name"
  else
    bash "$SCRIPT_DIR/upload-asset-to-oss.sh" --asset "$f" --name "$name" 2>&1 | tail -3
  fi
}
for a in "${ASSETS[@]}"; do
  obj="$(basename "$a")"
  echo "[el-updater] asset: $obj ($(stat -c%s "$a" 2>/dev/null || stat -f%z "$a") bytes)$([ -f "$a.blockmap" ] && echo ' + .blockmap')"
  upload_oss "$a" "$obj"
  [[ -f "$a.blockmap" ]] && upload_oss "$a.blockmap" "$obj.blockmap"
done

# 4. 部署 YML 到更新服务器(/var/www/updates 属 www-data → SCP /tmp + sudo cp)
TMP_REMOTE="/tmp/deskfox-electron-${ENV}-${YML_NAME}"
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[el-updater] (dry-run) 将 SCP: scp -i $SSH_KEY $OUT_YML $SERVER:$TMP_REMOTE"
  echo "[el-updater] (dry-run) 将远端: sudo cp $TMP_REMOTE $REMOTE_DIR/$YML_NAME + chown www-data + chmod 644"
  echo "[el-updater] (dry-run) 将校验: curl $VERIFY_URL"
else
  [[ -z "$SSH_KEY" ]] && { echo "[el-updater] ERROR: 无 SSH key,无法部署" >&2; exit 1; }
  echo "[el-updater] SCP $YML_NAME → 服务器 ..."
  scp -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 "$OUT_YML" "$SERVER:$TMP_REMOTE"
  ssh -i "$SSH_KEY" -o ConnectTimeout=20 "$SERVER" \
    "sudo mkdir -p '$REMOTE_DIR' && sudo cp '$TMP_REMOTE' '$REMOTE_DIR/$YML_NAME' && sudo chown www-data:www-data '$REMOTE_DIR/$YML_NAME' && sudo chmod 644 '$REMOTE_DIR/$YML_NAME' && rm -f '$TMP_REMOTE'"
  echo "[el-updater] 回读校验线上 $YML_NAME ..."; sleep 2
  ONLINE_VER=$(curl -s "$VERIFY_URL" | grep -oE '^version: *[0-9.]+' | head -1 | sed -E 's/version: *//')
  if [[ "$ONLINE_VER" == "$VERSION" ]]; then
    echo "[el-updater] ✅ 线上 version=$ONLINE_VER == 发布版本,升级源生效: $VERIFY_URL"
  else
    echo "[el-updater] ⚠️ 线上 version=$ONLINE_VER != $VERSION — 检查 nginx 缓存/CDN/路径" >&2; exit 1
  fi
fi

# 5. Gitee 镜像(国内备用下载;mac=.dmg / win=.exe)
#    mirror-asset-to-gitee.sh 首个参数是 release tag(位置参数,原脚本漏传致 Gitee 镜像必失败)→ 用 electron-<env>-<ver>。
GITEE_TAG="electron-${ENV}-${VERSION}"
if [[ "$NO_GITEE" -eq 0 ]]; then
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[el-updater] (dry-run) 将 Gitee 镜像: mirror-asset-to-gitee.sh $GITEE_TAG --asset $GITEE_ASSET"
  else
    bash "$SCRIPT_DIR/mirror-asset-to-gitee.sh" "$GITEE_TAG" --asset "$GITEE_ASSET" 2>&1 | tail -3 || echo "[el-updater] ⚠️ Gitee 镜像失败(非致命,主下载走 OSS)"
  fi
fi

echo "[el-updater] $([ $DRY_RUN -eq 1 ] && echo '✅ dry-run 完成(0 碰线上;改好的 latest.yml 在 '$OUT_YML')' || echo '✅ 发布完成')"
