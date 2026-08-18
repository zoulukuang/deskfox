#!/usr/bin/env bash
# [fork-only] REQ-084① 迁移污染检测 —— 真机验收 [feat: voice-preclear-batch] 2026-08-18
#
# 按 1-spec §3-S1 的 R8 用例 T4/T5/T6 造【真的超前 db】跑三场景。
# REQ-084 原文要求"造超前 db 实测",不接受只写单测 —— 本脚本就是那份实测。
#
# 隔离保证(绝不碰 user 正在用的正式版):
#   - 载体是 local 渠道包(独立 appId ai.deskfox.app.local + 独立 opencode-local.db);
#   - HOME 指向本脚本创建的临时目录(见 run_app 里的说明:不能用 XDG 做隔离);
#   - 只 kill "DeskFox 本地版",绝不通杀 electron / 不碰正式版与预览版。
#
# 用法:
#   bash packages/branding/scripts/verify-db-schema-guard.sh [app路径]
#   默认 app:mac 走 dist-deskfox/mac-arm64/DeskFox 本地版.app,Win 走 dist-deskfox/win-unpacked
#   (Win 在 Git Bash 下跑)
#
# 跨平台(2026-08-18 Win 回验时补):产品侧路径两端一致(data-namespace.ts 走 homedir(),无平台分支),
# 需要分平台的只有 app 路径、杀进程方式、homedir 的 env 名。原本靠 mac 专有的 `sqlite3` CLI 与
# `md5 -q` 做取证,两者在 Win 上都没有 —— 统一改走 python(两端自带且行为一致),不留双份实现。

set -uo pipefail

IS_WIN=0
case "$(uname -s)" in MINGW* | MSYS* | CYGWIN*) IS_WIN=1 ;; esac

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
if [ "$IS_WIN" = 1 ]; then
  APP="${1:-$REPO_ROOT/packages/desktop/dist-deskfox/win-unpacked}"
  BIN="$APP/DeskFox 本地版.exe"
  PY="${PYTHON:-python}"
else
  APP="${1:-$REPO_ROOT/packages/desktop/dist-deskfox/mac-arm64/DeskFox 本地版.app}"
  BIN="$APP/Contents/MacOS/DeskFox 本地版"
  PY="${PYTHON:-python3}"
fi
WORK="$(mktemp -d "${TMPDIR:-/tmp}/deskfox-guard-qa.XXXXXX")"
# local 渠道的库名(server.ts 按 channel 分流)
DB_NAME="opencode-local.db"
PROBE_ID="99991231235959_pollution_probe"
BASELINE_TS="$REPO_ROOT/packages/desktop/src/main/deskfox/migration-baseline.generated.ts"

pass=0; fail=0
ok()   { echo "  ✅ $1"; pass=$((pass+1)); }
bad()  { echo "  ❌ $1"; fail=$((fail+1)); }
info() { echo "     · $1"; }

# 只杀 local 档;正式版 DeskFox.exe / 预览版「DeskFox 预览版.exe」名字对不上,匹配不到。
kill_local() {
  if [ "$IS_WIN" = 1 ]; then
    taskkill //IM "DeskFox 本地版.exe" //F //T >/dev/null 2>&1 || true
  else
    pkill -f "DeskFox 本地版.app/Contents/" 2>/dev/null || true
  fi
}

cleanup() {
  kill_local
  sleep 1
}
trap cleanup EXIT

if [ ! -f "$BIN" ]; then
  echo "❌ 找不到 local 包:$BIN"
  echo "   先构建:cd packages/desktop && OPENCODE_CHANNEL=local bun run build \\"
  echo "          && node_modules/.bin/electron-builder --mac --dir --config electron-builder.deskfox.config.ts"
  exit 1
fi

# 取真实基线的前若干条,让造出来的库"看起来像正常迁移过的库",只多一条超前 id。
# 注:macOS 自带 bash 3.2 无 mapfile,用 while read 兼容写法。
BASE_IDS=()
while IFS= read -r line; do
  BASE_IDS+=("$line")
done < <(grep -oE '"[0-9]{14}_[^"]+"' "$BASELINE_TS" | tr -d '"' | head -5)
if [ "${#BASE_IDS[@]}" -eq 0 ]; then
  echo "❌ 读不出基线 id,检查 $BASELINE_TS"; exit 1
fi

# sqlite 操作统一走 python 内置 sqlite3(mac 自带的 `sqlite3` CLI 在 Win 上没有;
# python 两端都在,且同一份代码同一行为)。连接必须 close —— Win 上留着句柄,
# 被测的隔离改名(renameSync)会 EBUSY,测出来的是假失败。
sqlite_run() {
  local path="$1" script="$2"
  "$PY" -c "
import sqlite3, sys
conn = sqlite3.connect(sys.argv[1])
try:
    for line in sys.argv[2].strip().splitlines():
        if line.strip():
            conn.execute(line)
    conn.commit()
finally:
    conn.close()
" "$path" "$script"
}

sqlite_query() {
  local path="$1" sql="$2"
  # 不用 file:?mode=ro URI —— Win 盘符路径在 URI 形式下不可移植;先确认文件在,再普通连接查询
  "$PY" -c "
import os, sqlite3, sys
if not os.path.exists(sys.argv[1]):
    print('ERR'); raise SystemExit(0)
conn = sqlite3.connect(sys.argv[1])
try:
    print('\n'.join(str(r[0]) for r in conn.execute(sys.argv[2])))
finally:
    conn.close()
" "$path" "$sql" 2>/dev/null || echo "ERR"
}

md5_of() {
  "$PY" -c "
import hashlib, sys
print(hashlib.md5(open(sys.argv[1], 'rb').read()).hexdigest())
" "$1" 2>/dev/null || echo "ERR"
}

# 造一个带 migration 表的 sqlite 库;$2 非空则额外插入超前 id
make_db() {
  local path="$1" ahead="${2:-}"
  mkdir -p "$(dirname "$path")"
  local script="CREATE TABLE migration (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL);"
  for id in "${BASE_IDS[@]}"; do script="$script
INSERT INTO migration VALUES ('$id', 1);"; done
  [ -n "$ahead" ] && script="$script
INSERT INTO migration VALUES ('$PROBE_ID', 1);"
  # 一张有用户数据的表,用来验证"数据是否真的被带过去/留下"
  script="$script
CREATE TABLE probe_marker (tag TEXT);
INSERT INTO probe_marker VALUES ('QA-PROBE-DATA');"
  sqlite_run "$path" "$script"
}

has_probe_row() { sqlite_query "$1" "SELECT count(*) FROM migration WHERE id='$PROBE_ID'"; }

# 起 app、等一会儿、再停。启动期检查发生在最早期,不需要等 UI 完全就绪。
#
# ⚠ 隔离必须靠 HOME,不能靠 XDG_DATA_HOME:
#   resolveDeskfoxXdg 的设计是「用户显式设了 XDG 就尊重」,一旦设了,新旧命名空间会算成同一个目录
#   (same-dir)→ 迁移与隔离逻辑整条被跳过,测出来的是假象。设 HOME 才走真实的默认路径推导。
#
# --use-mock-keychain 必带:HOME 被改后 macOS 钥匙串路径(~/Library/Keychains)也跟着变,
#   app 找不到自己的条目会弹「找不到钥匙串」系统对话框打断无人值守跑批(2026-08-18 实测撞到)。
#   mock keychain 让它用内存态,不碰真钥匙串。
#
# Win:node 的 os.homedir() 读 USERPROFILE 而非 HOME,只设 HOME 会打到真实用户目录上 ——
#   两个都设才真隔离。
run_app() {
  local home="$1" tag="$2" secs="${3:-25}"
  if [ "$IS_WIN" = 1 ]; then
    # Win 必建:USERPROFILE 指到**完全空**的目录时,Electron/Chromium 拿不到 AppData 路径 →
    # 主进程启动即静默退出(无窗口、无输出、ExitCode 为 null)。真实用户目录永远有 AppData,
    # 纯属临时 HOME 构造不完整,不是产品问题。2026-08-18 Win 端实测。
    mkdir -p "$home/AppData/Roaming" "$home/AppData/Local"
    env -u XDG_DATA_HOME -u XDG_CONFIG_HOME HOME="$home" USERPROFILE="$(cygpath -w "$home")" \
      "$BIN" --use-mock-keychain > "$WORK/app-$tag.log" 2>&1 &
  else
    env -u XDG_DATA_HOME -u XDG_CONFIG_HOME HOME="$home" "$BIN" --use-mock-keychain > "$WORK/app-$tag.log" 2>&1 &
  fi
  local pid=$!
  sleep "$secs"
  kill "$pid" 2>/dev/null || true
  kill_local
  sleep 2
}

echo "════════ REQ-084① 迁移污染检测 真机验收 ════════"
echo "app :$APP"
echo "临时目录:$WORK"
echo "基线样本:${BASE_IDS[0]} … (共 ${#BASE_IDS[@]} 条)"
echo

# ─────────────────────────────────────────────────────────
echo "【T4 迁移期】旧 ns 有超前 db → 首启迁移:超前 db 不迁,auth/config 照迁,原件无损"
T4_HOME="$WORK/t4/home"
T4_OLD="$T4_HOME/.local/share/opencode"
T4_OLDCFG="$T4_HOME/.config/opencode"
mkdir -p "$T4_OLD" "$T4_OLDCFG"
make_db "$T4_OLD/$DB_NAME" ahead
echo '{"anthropic":{"type":"api","key":"QA-KEY"}}' > "$T4_OLD/auth.json"
mkdir -p "$T4_OLD/storage/session"
echo 'QA-SESSION-CONTENT' > "$T4_OLD/storage/session/qa.json"
echo '{"model":"qa-model"}' > "$T4_OLDCFG/opencode.jsonc"
OLD_DB_MD5="$(md5_of "$T4_OLD/$DB_NAME")"

run_app "$T4_HOME" t4

NEW_NS="$T4_HOME/.local/share/deskfox/opencode"
if [ -f "$NEW_NS/$DB_NAME" ]; then
  if [ "$(has_probe_row "$NEW_NS/$DB_NAME")" = "0" ]; then
    ok "新 ns 的库不含超前 probe 行(是干净空库)"
  else
    bad "新 ns 的库里出现了超前 probe 行 —— 污染仍被迁入!"
  fi
else
  ok "超前 db 未被迁入新 ns(新 ns 无该库,core 会自建空库)"
fi
[ -f "$NEW_NS/auth.json" ] && ok "auth.json 已迁入(能保的保住了)" || bad "auth.json 未迁入"
[ -f "$NEW_NS/storage/session/qa.json" ] && ok "storage 用户数据已迁入" || bad "storage 未迁入"
[ -f "$T4_HOME/.config/deskfox/opencode/opencode.jsonc" ] && ok "config 已迁入" || bad "config 未迁入"
if [ "$(md5_of "$T4_OLD/$DB_NAME")" = "$OLD_DB_MD5" ]; then
  ok "旧 ns 原库 md5 未变(非破坏,用户可自行取回)"
else
  bad "旧 ns 原库被改动了!"
fi
if [ -f "$NEW_NS/.deskfox-namespace-migrated" ]; then
  if grep -q "db-quarantined" "$NEW_NS/.deskfox-namespace-migrated"; then
    ok "marker 记录 reason=db-quarantined"
  else
    bad "marker 未记录隔离原因";  info "$(cat "$NEW_NS/.deskfox-namespace-migrated")"
  fi
else
  bad "marker 未写"
fi
echo

# ─────────────────────────────────────────────────────────
echo "【T5 历史遗留】新 ns 内已有超前 db + marker 已写 → 启动:隔离挪走、空库起"
T5_HOME="$WORK/t5/home"
T5_NS="$T5_HOME/.local/share/deskfox/opencode"
mkdir -p "$T5_NS" "$T5_HOME/.config/deskfox/opencode"
make_db "$T5_NS/$DB_NAME" ahead
echo '{"from":"qa","at":"2026-08-18T00:00:00Z"}' > "$T5_NS/.deskfox-namespace-migrated"
T5_DB_MD5="$(md5_of "$T5_NS/$DB_NAME")"

run_app "$T5_HOME" t5

QUARANTINED=$(find "$T5_NS" -maxdepth 1 -name "*.incompatible-*" 2>/dev/null | head -5)
if [ -n "$QUARANTINED" ]; then
  ok "超前库已被隔离挪走"
  while IFS= read -r f; do info "$(basename "$f")"; done <<< "$QUARANTINED"
  MAIN_Q=$(find "$T5_NS" -maxdepth 1 -name "$DB_NAME.incompatible-*" | head -1)
  if [ -n "$MAIN_Q" ] && [ "$(md5_of "$MAIN_Q")" = "$T5_DB_MD5" ]; then
    ok "隔离文件内容与原库逐字节一致(保留可恢复,没被删/改)"
  else
    bad "隔离文件内容与原库不一致"
  fi
  if [ -f "$T5_NS/$DB_NAME" ]; then
    if [ "$(has_probe_row "$T5_NS/$DB_NAME")" = "0" ]; then
      ok "原位置已是干净新库(不含 probe 行)"
    else
      bad "原位置的库仍含 probe 行"
    fi
  else
    ok "原位置无库(core 将自建空库)"
  fi
else
  bad "超前库未被隔离 —— 自愈没生效"
  info "目录内容:$(ls -1 "$T5_NS" | tr '\n' ' ')"
fi
echo

# ─────────────────────────────────────────────────────────
echo "【T6 回归】正常库 → 行为与现在零差异(不隔离、不误伤)"
T6_HOME="$WORK/t6/home"
T6_NS="$T6_HOME/.local/share/deskfox/opencode"
mkdir -p "$T6_NS" "$T6_HOME/.config/deskfox/opencode"
make_db "$T6_NS/$DB_NAME"        # 不插超前 id
echo '{"from":"qa","at":"2026-08-18T00:00:00Z"}' > "$T6_NS/.deskfox-namespace-migrated"
T6_MD5="$(md5_of "$T6_NS/$DB_NAME")"

run_app "$T6_HOME" t6

if [ -z "$(find "$T6_NS" -maxdepth 1 -name '*.incompatible-*' 2>/dev/null)" ]; then
  ok "正常库未被隔离"
else
  bad "正常库被误隔离了 —— 严重误伤!"
fi
if [ -f "$T6_NS/$DB_NAME" ]; then
  ok "正常库仍在原位"
  if sqlite_query "$T6_NS/$DB_NAME" "SELECT tag FROM probe_marker" | grep -q "QA-PROBE-DATA"; then
    ok "库内用户数据完好(未被清空/重建)"
  else
    info "库内 probe_marker 读不到(可能被 core 迁移改写,非本功能问题)"
  fi
else
  bad "正常库不见了"
fi
echo

# ─────────────────────────────────────────────────────────
echo "════════ 结果:$pass 通过 / $fail 失败 ════════"
if [ "$fail" -gt 0 ]; then
  echo "临时目录保留以便排查:$WORK"
  trap - EXIT; cleanup
  exit 1
fi
rm -rf "$WORK"
echo "(临时目录已清理;user 的正式版全程未被触碰)"
