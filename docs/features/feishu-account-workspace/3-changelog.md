feat-id: feishu-account-workspace
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实际改动 + commit + 回归测试 + 回退方法

> 规模:Medium（跨 TS adapter + Rust 命令 + GUI，纯 fork-only 文件，0 上游侵入）

## 一、需求一句话

每个飞书账号绑定一个专用真实项目目录作为 agent workspace，让飞书 Agent 远程参与该项目开发；飞书收的文件/图片落 `<workspace>/_deskfox/feishu/{files,images}`；改 workspace = 该账号换新家从零开始。

## 二、commit 列表

| commit | 内容 |
|---|---|
| `02315a608` | docs(feishu): 1-spec + 2-plan（含 R8 动工前测试用例清单） |
| `0d32b790c` | feat(feishu): 后端层 — schema/pipeline/_deskfox 落点/server 白名单（+测试） |
| `a69f06da5` | feat(feishu): Rust 命令 + GUI 文件夹选择器 + i18n |

## 三、改动文件

### 第 1 层 后端（TS adapter，fork-only）
| 文件 | 改动 |
|---|---|
| `core/config-schema.ts` | `FeishuAccount` 加 `workspace?: z.string().optional()` |
| `feishu/deskfox-dir.ts`（新） | `_deskfox/` 约定:`DESKFOX_DIR_NAME` + `deskfoxFeishuFilesDir/ImagesDir` + `ensureDeskfoxDir`（mkdir + `.gitignore` 幂等追加，DI 友好） |
| `feishu/message-pipeline.ts` | `workspaceDir()` helper;9 处 `query.directory` + PermissionCardController `workspaceDir` + ATTACH 白名单根 + 文件/图片落点全跟随 workspace;收文件/图片前 `ensureDeskfoxDir` |
| `feishu/image-downloader.ts` | `downloadFeishuImage` 加 `imagesRoot?` 参（默认全局，向后兼容），越界保护按其现算;删模块级 `FEISHU_IMAGES_DIR_RESOLVED` |
| `feishu/account-store.ts` | `updateAccountSettings` patch 加 `workspace?`（空串=清除走默认） |
| `server.ts` | `/accounts/update-settings` allowed/校验/patch/empty 判断加 workspace;`GET /accounts` wire 回 `workspace ?? null` |

### 第 2 层 Rust + GUI（fork-only）
| 文件 | 改动 |
|---|---|
| `desktop/src-tauri/src/feishu_adapter.rs` | `AccountSummary`/`ListAccountWireItem`/`UpdateAccountSettingsRequest`/wire 加 workspace;新命令 `feishu_pick_workspace_dir`（同步，`blocking_pick_folder`） |
| `desktop/src-tauri/src/lib.rs` | 注册 `feishu_pick_workspace_dir` |
| `app/src/utils/feishu-config.ts` | `AccountSummary` + `UpdateAccountSettingsPatch` 加 workspace;新 `feishuPickWorkspaceDir()` |
| `app/src/components/feishu-edit-account-dialog.tsx` | workspace 区块（当前值 + 选择文件夹/恢复默认 + P4 提示 + A1 安全提示）;save 仅在变化时发 |
| `app/src/components/settings-feishu.tsx` | 传 `currentWorkspace` |
| `app/src/i18n/{zh,en,zht}.ts` | 7 个 workspace i18n key |

## 四、关键设计点

- **hot 生效不删 chatSessionStore**:`/accounts/update-settings` → `onAccountsChanged` → `syncAccounts` 重建 pipeline → 新 `account.workspace` + 内存 `chatToSession` 清空 → 下条消息 `session.create` 到新 directory。验证 `chatSessionStore.get` 从未被调用，故无需删映射。
- **越界保护 per-root 现算**:image-downloader 原模块常量改为按传入 `imagesRoot` 现算 `resolve()+sep`，Windows 反斜杠安全。
- **folder picker 走 Rust**:JS 未装 plugin-dialog，Rust `tauri-plugin-dialog` + `dialog:default` capability 已就绪;同步命令 + `blocking_pick_folder`（worker 线程，避 tokio sync feature）。
- **空串语义统一**:GUI 恢复默认 / account-store / pipeline 三处都把空串/纯空白当"清除走全局默认"。

## 五、回归测试

- 单元 +18 断言（T1-T11/T18），adapter `bun test`：**723 pass / 0 fail**。
- typecheck：**17/17**（含 app + desktop）。
- Rust `cargo check`：**通过，0 新增 warning**。
- release build 集成验证：**成功**（`DeskFox.exe` 41MB，release profile 2m18s，Rust 命令注册 + 前端 bundle + exe 产出全过）。
- **真桌面 QA（T13-T16，未验）**:原生文件夹选择器 / hot 生效 / `_deskfox/` 落点 + gitignore / ATTACH 发回 —— 均需 user 真机验（CDP 覆盖不了 native + 真 sidecar + 真飞书）。

## 六、回退方法

三笔 commit 各自独立可 `git revert`。整体回退:`git revert <layer2> 0d32b790c 02315a608`。老账号无 workspace 字段 → `?? IMBOT_WORKSPACE` fallback，回退后行为完全恢复原状（全局共享 workspace）。
