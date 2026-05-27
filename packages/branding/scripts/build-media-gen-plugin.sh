#!/usr/bin/env bash
# [fork-only] 打包 media-gen plugin 进 installer 用(Mac/Linux 版,对称 build-media-gen-plugin.ps1)
# [feat: media-gen-bundle] 2026-05-27
# 复用 packages/media-gen/build.ts 出 dist/plugin.js,拷进 branding/plugin/media-gen/。
# Tauri 作为 resource ship,装完 lib.rs setup hook 注入 user opencode 配置(同 feishu-bridge)。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRANDING_ROOT="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$(dirname "$BRANDING_ROOT")")"

MEDIA_GEN_DIR="$REPO_ROOT/packages/media-gen"
SRC_DIST="$MEDIA_GEN_DIR/dist/plugin.js"
OUT_DIR="$BRANDING_ROOT/plugin/media-gen/dist"

if [ ! -f "$MEDIA_GEN_DIR/build.ts" ]; then
  echo "[media-gen-plugin] build.ts not found in $MEDIA_GEN_DIR" >&2
  exit 1
fi

echo "[media-gen-plugin] building media-gen dist (bun run build)..."
bun run --cwd "$MEDIA_GEN_DIR" build
[ -f "$SRC_DIST" ] || { echo "[media-gen-plugin] build reported success but no dist at $SRC_DIST" >&2; exit 1; }

mkdir -p "$OUT_DIR"
cp "$SRC_DIST" "$OUT_DIR/plugin.js"
echo "[media-gen-plugin] staged -> $OUT_DIR/plugin.js"
