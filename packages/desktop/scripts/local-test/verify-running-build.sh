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
#
# 判据锚在 ChannelIndicator 里被折叠后的 channel 常量。vite 把
# `import.meta.env.VITE_OPENCODE_CHANNEL` 换成字面量,打包器再把它提升成
# `function ChannelIndicator(props) { const channel = "local"; ... }`。
#
# FORK 2026-08-14 [feat: upstream-sync-2026-08]:旧判据找的是 `"local".toUpperCase`,
# 且用 grep(**按行**匹配)。两处都不成立:
#   ① 常量不再内联在调用点,被提升成了 `const channel = "local";`
#   ② 更要命的是产物**不是单行压缩的**,函数头与 const 分处两行,
#      grep 这类逐行工具原理上就跨不过去 —— 换任何 pattern 都白搭。
# 于是对着一个徽标明明正常显示 LOCAL 的包恒报 ⚠️。
# (实测反证:CDP 读 DOM 拿到 <div>LOCAL</div>,run_group1_native #10 首屏快照
#  原文也是「LOCAL 搜索 New DeskFox」。)
# 故改用 perl 的 slurp 模式(-0777)跨行匹配。
#
# 认不出时**只提示、不判失败** —— 这一项本质是静态猜测编译产物形状,
# 而产物形状随打包器变。会喊狼的守卫比没有守卫更坏:上次就是它把注意力
# 引去查根本没问题的 vite.js 兜底。真要确认,以运行时 CDP 读徽标为准。
CH=$(perl -0777 -ne 'if (/ChannelIndicator\([^)]*\)\s*\{\s*const channel = "(local|dev|beta|prod)"/) { print "$1\n"; exit }' \
     "$OUT"/renderer/assets/main-*.js 2>/dev/null | head -1 || true)
if [ -z "${CH:-}" ]; then
  echo "渲染层 channel(徽标): <静态判据未命中,不作数>"
  echo "ℹ️  认不出编译产物里的 channel 常量(打包器形态又变了?)——"
  echo "   本项跳过判定。要确认请开着应用用 CDP 读徽标 DOM,那才是权威判据。"
else
  echo "渲染层 channel(徽标): $CH"
  if [ "$CH" != "local" ]; then
    echo "⚠️  徽标不会显示 LOCAL(channel=$CH)—— 查 packages/app/vite.js 的 channel 兜底。"; RC=1
  fi
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
