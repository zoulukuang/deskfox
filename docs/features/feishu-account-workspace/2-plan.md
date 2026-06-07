feat-id: feishu-account-workspace
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实施计划 + 决策轨迹

## 实施顺序（分两层，便于 commit 边界 + 测试）

### 第 1 层：核心后端（TS adapter，可独立单测）
1. `config-schema.ts`：加 `workspace?` 字段 + 单测 T1/T2
2. 新文件 `feishu/deskfox-dir.ts`：`ensureDeskfoxDir` + 路径常量 helper（`deskfoxFeishuFilesDir(ws)` / `deskfoxFeishuImagesDir(ws)`）+ 单测 T6/T7
3. `image-downloader.ts`：`downloadFeishuImage` 加 `imagesRoot?` 参 + 越界保护重算 + 单测 T4/T5/T18
4. `message-pipeline.ts`：`workspaceDir()` helper + 替换 ~11 处 + 文件存储/ATTACH 根跟随 + 调 `ensureDeskfoxDir` + 单测 T3
5. `account-store.ts`：`updateAccountSettings` patch 加 workspace + listAccounts 回 workspace + 单测 T8/T9/T11
6. `server.ts`：`/accounts/update-settings` 加 workspace（allowed/校验/patch/empty 判断）+ list wire 回 workspace + 单测 T10

### 第 2 层：GUI + Rust 桥接（真桌面验）
7. Rust `feishu_adapter.rs`：请求/wire/list/summary 加 workspace + 新命令 `feishu_pick_workspace_dir`
8. Rust `lib.rs`：注册新命令
9. TS `feishu-config.ts`：类型 + `feishuPickWorkspaceDir()`
10. GUI `feishu-edit-account-dialog.tsx`：workspace 区块 + 文案 + i18n
11. 真桌面 QA（T13-T16）

## 决策轨迹（实施中追加）

- **2026-06-07 起**：spec 锁定，第 1 层先行。
- **空 workspace 语义**（T9）：定为"空串 = 清除 → 回退全局默认"，跟 model 字段 `null=清` 同范式，避免存空串当合法路径用。
- **gitignore 追加策略**：只追加 `_deskfox/` 一行；文件不存在则创建；存在但无该行则补（末尾无换行先补换行）；已含则跳过。仅在真实项目（有 `.git` 或任意内容）追加——全局 imbot-workspace 无 `.git` 也照常建 `_deskfox/` 但 gitignore 追加无害。
- **越界保护**（image-downloader）：原 `FEISHU_IMAGES_DIR_RESOLVED` 是模块常量，改为函数内按传入 `imagesRoot` 现算 `resolve(imagesRoot)+sep`，保持 Windows `path.sep` 处理。
- **folder picker 走 Rust 命令**：JS 侧未装 `@tauri-apps/plugin-dialog`，Rust 侧 `tauri-plugin-dialog=2` + `dialog:default` capability 已就绪 → 新建 Rust 命令 `feishu_pick_workspace_dir` 直接 `app.dialog().file().blocking_pick_folder()`，返回 `Option<String>`，不引 JS 新依赖。
