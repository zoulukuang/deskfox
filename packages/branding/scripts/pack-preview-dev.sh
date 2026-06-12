#!/usr/bin/env bash
# [fork-only] DeskFox「打包预览版」固定任务流(macOS,Tier 2 dev channel)
#
# 用途:一条命令完成本地预览版(dev)打包,仅本地、不碰版本号 bump / 不重命名 / 不发布。
#   适合本机测试自用。要规范命名 + 版本号递增 + 发布,走 pack-installer.sh / /ship。
#
# 设计要点(踩坑固化,2026-06-09):
#   - 显式补 cargo 到 PATH:非交互 shell 不一定加载 ~/.zshenv,cargo 不在 PATH 会 "not found"
#     而整次构建瞬间失败。这是历史上后台构建"假装在跑实则秒死"的真因。
#   - 旧 dmg 移到备份目录(不删),便于失败回退 + 用时间戳证明新产物是全新生成。
#   - 全程日志落到固定文件,跑完打印 DONE 标记 + 真实产物路径/时间戳/大小。
#   - 推荐后台跑:`run_in_background` 启动本脚本,退出即通知;用产物时间戳作硬证据监测。
#
# 用法:
#   bash packages/branding/scripts/pack-preview-dev.sh
#   后台:nohup bash packages/branding/scripts/pack-preview-dev.sh >/tmp/pack-preview-dev.log 2>&1 &

set -uo pipefail

# --- 0. 环境 ---
# 显式钉死 bun + rust 工具链:非交互 shell(如下方 header 推荐的 nohup bash)不读 ~/.zshenv,
# 缺任一即"假装在跑实则秒死"。build-deskfox.sh 硬依赖 bun(build / tauri build)+ cargo(编译)。
#   - bun 真身在 ~/.bun/bin;/Volumes/ExtSSD/.bun/bin/bun 是指向 bun.exe 的坏 symlink,勿用。
#   - cargo 是 rustup shim,必须有 RUSTUP_HOME 才能定位 toolchain(否则 "rustup could not
#     choose a version of cargo" 直接死);CARGO_HOME 带 npmmirror 镜像配置。
# 用已验证的确定值,不 source .zshenv(其 bun 行指向坏 symlink,会漂移)。
export PATH="$HOME/.bun/bin:/Volumes/ExtSSD/.cargo/bin:$PATH"
export CARGO_HOME="/Volumes/ExtSSD/.cargo"
export RUSTUP_HOME="/Volumes/ExtSSD/.rustup"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$REPO_ROOT"

DMG_DIR="$REPO_ROOT/packages/desktop/src-tauri/target/release/bundle/dmg"
APP_DIR="$REPO_ROOT/packages/desktop/src-tauri/target/release/bundle/macos"
BACKUP_DIR="$REPO_ROOT/packages/desktop/src-tauri/target/release/.preview-old"

echo "=================================================="
echo "[pack-preview] DeskFox 预览版(dev)打包任务流"
echo "[pack-preview] repo: $REPO_ROOT"
echo "[pack-preview] cargo: $(cargo --version 2>&1)"
echo "[pack-preview] bun:   $(bun --version 2>&1)"
echo "=================================================="

# --- 1. 杀残留(避免锁文件 / 端口占用;不杀本脚本与编译器) ---
echo "[pack-preview] [1/4] 杀残留运行实例..."
pkill -9 -f "DeskFox Dev" 2>/dev/null || true
pkill -9 -f "opencode-cli" 2>/dev/null || true
sleep 1

# --- 2. 移走旧 dmg(留备份,便于回退 + 时间戳取证) ---
echo "[pack-preview] [2/4] 备份旧 dmg..."
mkdir -p "$BACKUP_DIR"
if ls "$DMG_DIR"/*.dmg >/dev/null 2>&1; then
  for f in "$DMG_DIR"/*.dmg; do
    mv "$f" "$BACKUP_DIR/$(basename "$f").bak"
    echo "[pack-preview]   moved: $(basename "$f") -> .preview-old/"
  done
else
  echo "[pack-preview]   (无旧 dmg)"
fi

# --- 3. 官方完整构建(dev channel,含 sidecar 校验 + 内置 LibreOffice + dmg 打包) ---
echo "[pack-preview] [3/4] 跑官方构建 build-deskfox.sh -Env dev ..."
bash "$SCRIPT_DIR/build-deskfox.sh" -Env dev
BUILD_RC=$?
if [[ "$BUILD_RC" -ne 0 ]]; then
  echo "[pack-preview] !! 构建失败 exit=$BUILD_RC"
  echo "DONE rc=$BUILD_RC"
  exit "$BUILD_RC"
fi

# --- 4. 报告真实产物 ---
echo "[pack-preview] [4/4] 产物:"
for app in "$APP_DIR"/*.app; do
  [[ -d "$app" ]] && echo "  .app: $app  ($(du -sh "$app" 2>/dev/null | cut -f1))  mtime=$(stat -f '%Sm' "$app")"
done
for dmg in "$DMG_DIR"/*.dmg; do
  [[ -f "$dmg" ]] && echo "  .dmg: $dmg  ($(du -sh "$dmg" 2>/dev/null | cut -f1))  mtime=$(stat -f '%Sm' "$dmg")"
done

echo "DONE rc=0"
