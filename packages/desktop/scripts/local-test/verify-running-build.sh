#!/usr/bin/env bash
# verify-running-build.sh — 真实触发验收前,先证明「我要测的本地版.app 就是刚构建那个」,
# 而不是一个过期包。专治 v2026.8.2 那次踩的坑:重打包静默失败(electron-builder 联网超时),
# .app 没更新,却在旧产物上报「✅ 已验证 LOCAL」。
#
# 本脚本住在 fork 内 packages/desktop/scripts/local-test/(就近构建);repo 根从脚本位置推导,可移植。
# 用法: verify-running-build.sh [repo_root]   (repo_root 缺省=本脚本上溯 4 级的仓根)
set -euo pipefail
REPO="${1:-$(cd "$(dirname "$0")/../../../.." && pwd)}"
APP="$REPO/packages/desktop/dist-deskfox/mac-arm64/DeskFox 本地版.app"
RES="$APP/Contents/Resources"
OUT="$REPO/packages/desktop/out"
RC=0

if [ ! -d "$APP" ]; then echo "❌ 没找到本地版.app: $APP" >&2; exit 3; fi

PID=$(pgrep -f "MacOS/DeskFox 本地版" 2>/dev/null | head -1 || true)
echo "本地版 进程: ${PID:-<未在跑>}"

# 1) 产物新鲜度:打包的 app.asar 不能比源码 out/ 旧
ASAR_T=$(stat -f %m "$RES/app.asar" 2>/dev/null || echo 0)
OUT_T=$(find "$OUT" -type f -exec stat -f %m {} \; 2>/dev/null | sort -n | tail -1 || echo 0)
echo "app.asar 时间 : $(date -r "${ASAR_T:-0}" 2>/dev/null)"
echo "最新 out/ 时间: $(date -r "${OUT_T:-0}" 2>/dev/null)"
if [ "${OUT_T:-0}" -gt "${ASAR_T:-0}" ]; then
  echo "⚠️  STALE:out/ 比打包的 app.asar 新 —— 你将要测的是旧包。先跑 repack-local.sh。"; RC=1
else
  echo "✅ app.asar 不旧于 out/ —— 包体反映了最新构建。"
fi

# 2) 渲染层烤进的 channel(决定徽标显示),必须是 local
CH=$(grep -rhoE '"(local|dev|beta|prod)"\.toUpperCase' "$OUT/renderer" 2>/dev/null \
     | grep -oE 'local|dev|beta|prod' | head -1 || true)
echo "渲染层 channel(徽标): ${CH:-<未知>}"
if [ "${CH:-}" != "local" ]; then
  echo "⚠️  徽标不会显示 LOCAL(channel=$CH)—— 查 packages/app/vite.js 的 channel 兜底。"; RC=1
fi

# 3) build stamp(由 repack-local.sh 写入,可选)
if [ -f "$RES/.deskfox-build-stamp" ]; then echo "build stamp: $(cat "$RES/.deskfox-build-stamp")"; fi

# 4) 真正在跑的进程加载的是这个产物的 app.asar 吗(按文件名查持有者,空格安全)
HOLDERS=$(lsof -t "$RES/app.asar" 2>/dev/null | tr '\n' ' ' || true)
if [ -n "${HOLDERS// /}" ]; then
  echo "加载这个本地版 app.asar 的进程: ${HOLDERS}✅"
else
  echo "⚠️  没有进程加载这个本地版产物的 app.asar —— 当前没在跑它(或 open 聚焦了旧实例)。"; RC=1
fi

[ "$RC" = 0 ] && echo "—— 结论:可以放心在这个本地版上做真实触发验收。" \
             || echo "—— 结论:先修上面 ⚠️ 再验,否则是在过期/错误产物上验。"
exit $RC
