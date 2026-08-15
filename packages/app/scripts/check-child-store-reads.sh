#!/usr/bin/env bash
# FORK-ONLY: 上游同步验收闸 —— 检测「绕过全局重定向、直读 child store 会话字段」
#
# 起源:2026-08 上游同步(1.17.4 → 1.18.16)后连出两条同族回归 ——
#   REQ-110 会话列表运行中图标不亮(读 child store 的 session_status)
#   REQ-112 权限过滤层整体失效(读 child store 的 permission)
# 共同形状:1.18 把这些字段的权威源挪到**全局 session store**,
# `context/directory-sync.ts` 的 Proxy 专门做重定向;但凡代码拿的是
# `sync.child(...)` 的原始 store,就绕过了 Proxy,读到的是**永远为空**的旧位置。
#
# 这一族现有手段全抓不到:typecheck 绿(类型完全合法)、FORK marker 一个不少
# (代码一行没删)、单端 e2e 跑不出(要双 instance 并发才显形)。故设本闸。
#
# 用法:bash packages/app/scripts/check-child-store-reads.sh(任意 cwd 均可)
# 退出码:0 = 无命中;1 = 有命中(需人工复核每一处)
#
# 落点说明:本该放仓根 scripts/,但 .husky/pre-commit 的 SCRIPTS_ALLOWED 只放行
# install-hooks.sh(根 scripts/ 整目录治理锁);故就近放在被扫代码所在的 packages/app 下,
# 不走 override-blacklist 破例。
#
# 复核口径(命中不等于 bug):
#   ✅ 合规 —— 读的是 child 自有字段(session / vcs / path / project / icon / config / mcp / lsp)
#   ✅ 合规 —— 经 `directory-sync.ts` 的 Proxy(`data.xxx`)读,Proxy 会重定向到全局
#   ❌ 违规 —— 从 `sync.child(...)` 返回值上直接取下面 SESSION_FIELDS 里的字段
#
# 字段清单的**唯一事实源**是 directory-sync.ts 的 sessionFields,本脚本会实时解析它,
# 上游若增删字段这里自动跟随(解析失败则回落到硬编码快照并告警)。

set -uo pipefail

# 仓根定位:优先按脚本自身位置推(与 cwd 无关),git 顶层作兜底。
# 【fail-closed】定位不到就退 2 报错 —— 验收闸误绿比误报危险得多:
# 早期版本在仓外跑会回落到 `.`,扫不到任何文件却输出「✅ 无命中」。
ROOT="$(cd "$(dirname "$0")/../../.." 2>/dev/null && pwd)"
if [ ! -d "${ROOT:-/nonexistent}/packages/app/src" ]; then
  ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
fi
if [ -z "${ROOT:-}" ] || [ ! -d "$ROOT/packages/app/src" ]; then
  echo "❌ 定位不到仓根(找不到 packages/app/src),拒绝在未知目录下给出结论" >&2
  exit 2
fi
cd "$ROOT" || exit 2

DIRSYNC="packages/app/src/context/directory-sync.ts"
FALLBACK_FIELDS="session_status session_working session_diff todo permission question message session_message part part_text_accum_delta"

if [[ -f "$DIRSYNC" ]]; then
  # 抓 `const sessionFields = new Set([ ... ])` 里的字符串字面量
  FIELDS=$(awk '/const sessionFields = new Set\(\[/,/\]\)/' "$DIRSYNC" \
    | grep -oE '"[a-z_]+"' | tr -d '"' | tr '\n' ' ')
else
  FIELDS=""
fi

if [[ -z "${FIELDS// /}" ]]; then
  echo "⚠️  未能从 $DIRSYNC 解析 sessionFields,回落到硬编码快照" >&2
  echo "    (上游若重构了该文件,请更新本脚本的解析逻辑)" >&2
  FIELDS="$FALLBACK_FIELDS"
fi

echo "受保护字段(权威源 = 全局 session store):"
echo "  $FIELDS"
echo

SCAN_PATHS=(packages/app/src packages/ui/src packages/session-ui/src packages/desktop/src)

# 收集所有把 child store 绑到局部变量的行,取出变量名。
# 覆盖三种写法:
#   const [store] = sync.child(dir)
#   const [childStore] = input.sync.child(dir, { bootstrap: false })
#   const [child] = serverSync().child(dir, ...)
# 注:macOS 自带 bash 3.2 没有 mapfile,故走临时文件 + while read(可移植)
BINDINGS_FILE=$(mktemp)
trap 'rm -f "$BINDINGS_FILE"' EXIT

grep -rnE 'const \[[A-Za-z_][A-Za-z0-9_]*(, *[A-Za-z_][A-Za-z0-9_]*)?\] *= *[A-Za-z_().]*child\(' \
  "${SCAN_PATHS[@]}" \
  --include='*.ts' --include='*.tsx' 2>/dev/null \
  | grep -vE '\.test\.|\.stories\.' > "$BINDINGS_FILE"

hits=0
report=""

while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  file="${line%%:*}"
  rest="${line#*:}"
  lineno="${rest%%:*}"
  code="${line#*:*:}"

  # 取解构出的第一个变量名(第二个是 setStore,写入不在本闸范围)
  var=$(printf '%s' "$code" | sed -nE 's/.*const \[ *([A-Za-z_][A-Za-z0-9_]*).*/\1/p')
  [[ -z "$var" ]] && continue

  # 在该绑定之后的 60 行窗口内,找 <var>.<受保护字段> 的读取
  for f in $FIELDS; do
    found=$(awk -v start="$lineno" -v span=60 -v pat="(^|[^A-Za-z0-9_.])${var}\\.${f}([^A-Za-z0-9_]|$)" \
      'NR >= start && NR <= start + span && $0 ~ pat { printf "%d:%s\n", NR, $0 }' "$file")
    [[ -z "$found" ]] && continue
    while IFS= read -r m; do
      [[ -z "$m" ]] && continue
      hits=$((hits + 1))
      report+="  ❌ $file:${m%%:*}"$'\n'
      report+="     绑定于 :$lineno  变量 \`$var\`  直读受保护字段 \`$f\`"$'\n'
      report+="     $(printf '%s' "${m#*:}" | sed 's/^[[:space:]]*//')"$'\n\n'
    done <<< "$found"
  done
done < "$BINDINGS_FILE"

if [[ $hits -eq 0 ]]; then
  echo "✅ 未发现绕过全局重定向的 child store 直读"
  exit 0
fi

echo "发现 $hits 处 child store 直读受保护字段 —— 逐条人工复核:"
echo
printf '%s' "$report"
cat <<'EOF'
复核方式:确认该字段在当前上游版本里是否还会写进 child store。
  - 引导路径:packages/app/src/context/global-sync/bootstrap.ts —— 看是否走
    `if (input.session) …` 分支(走了 = 只写全局,child 拿不到)
  - 事件路径:packages/app/src/context/global-sync/event-reducer.ts —— 看该事件是否在
    SESSION_CONTENT_EVENTS 里,且调用点传了 `sessionContent: false`(是 = 直接 early return)
两条路径都不落 child ⇒ 该处读到的恒为空,是 REQ-110 / REQ-112 同款静默失效。

修法:改读全局 session store(`serverSync.session.data.<字段>`),
并按 `directory` 过滤 session —— 全局 store 是全目录混装的,不筛会跨项目污染。
EOF

exit 1
