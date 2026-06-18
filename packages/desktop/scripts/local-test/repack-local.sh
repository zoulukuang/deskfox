#!/usr/bin/env bash
# repack-local.sh — 零联网、外科式地把本地版.app 的 app.asar 用最新 out/ 重打,
# 绕开 electron-builder(它每次都做联网动作,国内常 10 分钟超时然后静默失败)。
# v2026.8.2 那次就是靠这招才让 vite.js 的 LOCAL 徽标修复真正进到 .app。
#
# 适用场景:已经成功打过一次完整 .app(electron 二进制/结构都在),之后只改了 JS,
# 想快速出一个能测的新包。
#
# 本脚本住在 fork 内 packages/desktop/scripts/local-test/(就近构建);repo 根从脚本位置推导,可移植。
# 用法: repack-local.sh [repo_root]   (repo_root 缺省=本脚本上溯 4 级的仓根)
set -euo pipefail
REPO="${1:-$(cd "$(dirname "$0")/../../../.." && pwd)}"
APP="$REPO/packages/desktop/dist-deskfox/mac-arm64/DeskFox 本地版.app"
RES="$APP/Contents/Resources"
OUT="$REPO/packages/desktop/out"

[ -d "$APP" ] || { echo "❌ 没有现成的本地版.app($APP);先完整打一次包。" >&2; exit 3; }
[ -d "$OUT" ] || { echo "❌ 没有 out/($OUT);先跑 OPENCODE_CHANNEL=local bun run build。" >&2; exit 3; }

ASAR=$(find "$REPO/node_modules/.bun" -path "*@electron+asar*/bin/asar*.js" 2>/dev/null | head -1)
[ -z "$ASAR" ] && ASAR=$(find "$REPO/node_modules" -path "*asar/bin/asar*.js" 2>/dev/null | head -1)
[ -z "$ASAR" ] && { echo "❌ 找不到 @electron/asar 的 CLI。" >&2; exit 3; }
echo "asar CLI: $ASAR"

# 0) 退掉在跑的本地版(单实例锁)
osascript -e 'quit app "DeskFox 本地版"' 2>/dev/null || true
pkill -f "MacOS/DeskFox 本地版" 2>/dev/null || true
sleep 2

WORK=$(mktemp -d)
echo "1) 抽出现有 asar -> $WORK/x"
node "$ASAR" extract "$RES/app.asar" "$WORK/x"
# extract 不含 unpacked 的原生模块,补回来(否则 node-pty 等 .node 缺失会崩)
if [ -d "$RES/app.asar.unpacked" ]; then
  echo "   合并 app.asar.unpacked(原生模块)"
  cp -R "$RES/app.asar.unpacked/." "$WORK/x/" 2>/dev/null || true
fi

echo "2) 换上最新 out/"
rm -rf "$WORK/x/out"
cp -R "$OUT" "$WORK/x/out"

echo "3) 写 build stamp(供 verify-running-build.sh 读)"
STAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
printf '%s\n' "$STAMP" > "$RES/.deskfox-build-stamp"

echo "4) 重打:纯 JS 进 asar,.node 进 unpacked"
rm -rf "$RES/app.asar.unpacked"
node "$ASAR" pack "$WORK/x" "$RES/app.asar" --unpack "**/*.node"
rm -rf "$WORK"

echo "✅ 重打完成 @ $STAMP"
echo "   asar: $RES/app.asar"
echo "   下一步: bash $(dirname "$0")/verify-running-build.sh \"$REPO\"  然后  open \"$APP\""
