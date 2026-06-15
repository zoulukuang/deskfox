feat-id: dev-feishu-binding-missing
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 3-changelog — 实际改动

> commit:`(本笔 commit)`(feat 分支 `fix/dev-feishu-binding-missing`,基于 `feat/electron-replatform`)

## 改动文件

| 文件 | 类型 | 说明 |
|---|---|---|
| `packages/branding/scripts/build-deskfox-electron.sh` | 改(fork-only) | §3.5a:打包前自动重建 feishu-bridge / media-gen 插件 dist(调既有 `build-{feishu,media-gen}-plugin.sh`)+ post-build 守卫:bundle 残留 `Bun.serve` 即 fail |

> 飞书 / media-gen 的 `dist/plugin.js` 是 gitignored 现场产物,本次随脚本重建但不入仓。

## 改动要点

**原 §3.5a**(只检查存在):
```bash
for _p in "$FEISHU_PLUGIN" "$MEDIA_PLUGIN"; do
  if [[ ! -f "$_p" ]]; then ... warn/exit ... ; fi
done
```

**新 §3.5a**(先重建 + Bun 守卫):
```bash
bash "$SCRIPT_DIR/build-feishu-plugin.sh"      # 时间戳判断,无变更秒跳过
bash "$SCRIPT_DIR/build-media-gen-plugin.sh"
for _p in "$FEISHU_PLUGIN" "$MEDIA_PLUGIN"; do
  [[ -f "$_p" ]] || { echo "❌ 重建后仍缺失"; exit 1; }
  grep -q "Bun\.serve" "$_p" && { echo "❌ 仍含 Bun.serve → Node 边车下插件 server 起不来"; exit 1; }
done
```

## 回归防线(R5)

本次 bug 无传统单测面(纯构建管线 + bundle 产物问题)。**回归防线 = post-build Bun 守卫本身**:今后任何源码未适配 / 构建目标错导致 dist 残留 `Bun.serve`,打包阶段即 fail,不会再静默发出"插件起不来"的包。`[bug-repro: 陈旧/含 Bun.serve 的 plugin dist 打进 Electron 包 → 守卫必须拦下]`

## 验证

- 重建后插件 dist:`Bun.serve` 残留 **0**(feishu + media-gen)。
- 构建日志:`plugin dist 就绪且无 Bun.serve 残留 ✓`。
- 重打 dev `--no-bundle` 包内 plugin.js:`Bun.serve` = 0。
- 重启后端到端:
  - 飞书 server 新 `server.json` → `127.0.0.1:51438`,端口**活监听**(DeskFox PID)。
  - 最新会话 `server.log`:`Bun is not defined` 计数 **0**;`[feishu-plugin] synced: WSS=3/3 pipelines=3`(3 账号全连)。
  - `GET /accounts` 返回 **3 账号**(InveM🐼-Mac / 灵狐🦊-Mac / FoxPlan-Mac)。
  - UI 飞书桥接页列出 3 个账号(user 真机确认)。

## 影响范围 / 回退

- 仅 1 个 fork-only 构建脚本改动;0 上游侵入 / 0 R4 / 0 黑名单。
- 回退:`git revert <本笔 hash>`(退回"只检查存在"老行为)。

## 遗留(另记,本次范围外)

1. **prod/dev 插件注册互争**:dev 启动 `plugin-install: exclusive takeover` 抢掉正式版 `/Applications/DeskFox.app` 的 `opencode.jsonc` 插件注册项 —— 同机并存隐患,待单独排查。
2. **飞书 multipart 上传**:图片/文件上传在 Node 下的 Buffer/form-data 兼容性(历史 Bun-plugin-form-data 坑),待单独验。
