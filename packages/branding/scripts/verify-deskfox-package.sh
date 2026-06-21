#!/usr/bin/env bash
# [fork-only] DeskFox 打包产物自动化验证(A 层包完整性 + B 层 sidecar headless 冒烟)
# [feat: package-verify-script] 2026-06-01
#
# 对称 build-deskfox-electron.sh:打完包(完整 bundle,非 --no-bundle)后跑这个,零 GUI / 零焦点干扰,
# 自动断言 .app 结构 / 架构 / 身份(三档 Bundle ID)/ Gatekeeper / media-gen plugin 内联数据,
# 再真启动 .app 内 opencode-cli sidecar 做 headless 冒烟 + plugin.js ESM 加载冒烟。
#
# 为什么需要:Mac WKWebView 不支持 CDP,GUI 自动化坑多且会占用 user 电脑(见 e2e-tauri-mac/README)。
# 本脚本覆盖「不需要 GUI 就能自动验证」的两层——包结构完整性 + sidecar/plugin 真能跑起来,
# 把 GUI 肉眼确认压缩到最小。每次打包后一键自检,稳定 > 一切。
#
# 用法:
#   bash packages/branding/scripts/verify-deskfox-package.sh            # 默认 prod
#   bash packages/branding/scripts/verify-deskfox-package.sh -Env dev
#   bash packages/branding/scripts/verify-deskfox-package.sh -Env beta
#
# 退出码:0=全过,1=有失败项。依赖调用环境已配好 PATH(bun / curl;同 build-deskfox-electron.sh,不内联 export)。

set -uo pipefail

ENV="prod"
while [[ $# -gt 0 ]]; do
  case "$1" in
    -Env|--env|-e) ENV="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

# 三档 .app 名 + Bundle ID(真相源:packages/desktop/electron-builder.deskfox.config.ts)
case "$ENV" in
  prod) APP_NAME="DeskFox";      EXPECT_BID="ai.deskfox.app" ;;
  beta) APP_NAME="DeskFox Beta"; EXPECT_BID="ai.deskfox.app.beta" ;;
  dev)  APP_NAME="DeskFox Dev";  EXPECT_BID="ai.deskfox.app.dev" ;;
  *) echo "Usage: $0 -Env <dev|beta|prod>" >&2; exit 2 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../../.." && pwd)"
APP="$REPO/packages/desktop/src-tauri/target/release/bundle/macos/$APP_NAME.app"
BIN="$APP/Contents/MacOS/$APP_NAME"
SIDE="$APP/Contents/MacOS/opencode-cli"
PLUGIN="$APP/Contents/Resources/plugin/media-gen/dist/plugin.js"
PLIST="$APP/Contents/Info.plist"
CATALOG_DATA="$REPO/packages/media-gen/src/catalog.data.json"

command -v bun >/dev/null 2>&1 || { echo "❌ 需要 bun 在 PATH(同 build-deskfox-electron.sh 的调用环境)" >&2; exit 2; }

pass=0; fail=0
ok()  { echo "  ✅ $1"; pass=$((pass+1)); }
bad() { echo "  ❌ $1"; fail=$((fail+1)); }
chk() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }

echo "════════════════════════════════════════"
echo " DeskFox 包验证 — env=$ENV  ($APP_NAME.app)"
echo "════════════════════════════════════════"
if [ ! -d "$APP" ]; then
  echo "❌ 找不到 $APP"
  echo "   先打完整包:bash packages/branding/scripts/build-deskfox-electron.sh -Env $ENV"
  exit 1
fi

echo "── A 层:包完整性 ──"
echo "[结构]"
chk "主 binary 存在"       "[ -f '$BIN' ]"
chk "sidecar opencode-cli" "[ -f '$SIDE' ]"
chk "media-gen plugin"     "[ -f '$PLUGIN' ]"
chk "Info.plist"           "[ -f '$PLIST' ]"
chk "图标 .icns"           "ls '$APP/Contents/Resources/'*.icns >/dev/null 2>&1"

echo "[二进制架构 / 可执行]"
chk "主 binary arm64"      "file '$BIN' | grep -q arm64"
chk "sidecar arm64"        "file '$SIDE' | grep -q arm64"
chk "主 binary 可执行"     "[ -x '$BIN' ]"
chk "sidecar 可执行"       "[ -x '$SIDE' ]"
chk "主 binary 非空(>1MB)" "[ \$(stat -f%z '$BIN') -gt 1000000 ]"
chk "sidecar 非空(>10MB)"  "[ \$(stat -f%z '$SIDE') -gt 10000000 ]"

echo "[身份 / 版本(env=$ENV)]"
BID=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$PLIST" 2>/dev/null)
VER=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$PLIST" 2>/dev/null)
EXE=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$PLIST" 2>/dev/null)
echo "    Bundle ID=$BID / 版本=$VER / Executable=$EXE"
chk "Bundle ID = $EXPECT_BID($ENV 档)" "[ '$BID' = '$EXPECT_BID' ]"
chk "CFBundleExecutable = $APP_NAME"   "[ '$EXE' = '$APP_NAME' ]"

echo "[Gatekeeper]"
chk "无 com.apple.quarantine" "! xattr -p com.apple.quarantine '$APP' >/dev/null 2>&1"

echo "[media-gen catalog 内联数据完整]"
chk "catalog 字面量数据在" "grep -q 'xiaomi-mimo-v2.5-tts-voiceclone' '$PLUGIN'"
chk "标签「语音合成」"     "grep -q '语音合成' '$PLUGIN'"
chk "标签「语音识别」"     "grep -q '语音识别' '$PLUGIN'"
chk "catalog.data 运行时外部读取=0" "[ \$(grep -cE '(readFileSync|require|fetch)[^;]*catalog\.data' '$PLUGIN') -eq 0 ]"
MISS=0
for m in $(bun -e 'const d=require("'"$CATALOG_DATA"'");console.log([...new Set(d.map(e=>e.model))].join("\n"))'); do
  grep -q "$m" "$PLUGIN" || { echo "    缺 model: $m"; MISS=1; }
done
[ "$MISS" = "0" ] && ok "全部 catalog model id 已内联进包" || bad "有 model id 未内联"

echo ""
echo "── B 层:sidecar headless 冒烟 ──"
PORT=47821
LOG="$(mktemp -t deskfox-sidecar-smoke).log"
echo "[B1] 启动 .app 内 opencode-cli serve 127.0.0.1:$PORT ..."
"$SIDE" serve --hostname 127.0.0.1 --port $PORT >"$LOG" 2>&1 &
SPID=$!
listening=0
for _ in $(seq 1 30); do
  grep -q "listening on" "$LOG" 2>/dev/null && { listening=1; break; }
  kill -0 $SPID 2>/dev/null || break
  sleep 0.5
done
if [ "$listening" = "1" ]; then
  ok "sidecar 监听($(grep 'listening on' "$LOG" | head -1 | sed 's/.*listening on //'))"
  curl -s -o /dev/null -m 4 -w '%{http_code}' "http://127.0.0.1:$PORT/" | grep -qE '^(2|3|4)' \
    && ok "HTTP server 真响应" || bad "HTTP server 无响应"
  grep -iqE 'fatal|uncaught|panic|cannot find module|SyntaxError' "$LOG" \
    && bad "sidecar 日志有 fatal/uncaught(见 $LOG)" || ok "sidecar 日志无 fatal/uncaught"
else
  bad "sidecar 15s 内未监听(见 $LOG)"
fi
kill $SPID 2>/dev/null; wait $SPID 2>/dev/null

echo "[B2] media-gen plugin.js ESM 加载冒烟 ..."
B2=$(bun -e '
(async () => {
  try {
    const m = await import("'"$PLUGIN"'");
    const keys = Object.keys(m);
    console.log(keys.length ? "OK:" + keys.join(",") : "FAIL:no-export");
  } catch (e) { console.log("FAIL:" + (e.message||e)); }
})();
' 2>&1)
echo "$B2" | grep -q '^OK:' && ok "plugin.js ESM 加载成功(导出 $(echo "$B2"|sed 's/^OK://'))" || bad "plugin.js 加载失败: $B2"
rm -f "$LOG"

echo ""
echo "════════════════════════════════════════"
echo " 汇总 env=$ENV:PASS=$pass  FAIL=$fail"
echo "════════════════════════════════════════"
[ "$fail" -eq 0 ] && { echo "✅ 全部通过"; exit 0; } || { echo "❌ 有失败项"; exit 1; }
