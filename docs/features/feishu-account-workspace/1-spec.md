feat-id: feishu-account-workspace
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 飞书账号级 Workspace —— 需求 + 验收标准 + 架构选型

> 决策日期：2026-06-07
> 规模：Medium（跨 TS adapter + Rust 命令 + GUI 弹窗，纯 fork-only 文件，0 上游侵入）
> 决策来源：`~/.opencode/imbot-workspace/飞书_账号级Workspace_决策.md` + 2026-06-07 user 逐条拍板

---

## 一、需求

让**每个飞书账号绑定一个专用的真实项目目录**作为 agent 的工作目录（workspace），取代现在所有账号硬共享全局 `~/.opencode/imbot-workspace`。

**核心使用场景（关键定位）**：让飞书 Agent **参与真实项目的远程开发**——人不在电脑前时，通过飞书在真实项目目录里写代码、读写真实文件、跑命令。未来每个常用项目都配一个专用飞书账号沟通。

---

## 二、核心设计原则（已定）

> **workspace 是 session 的归属地。改 workspace ≠ 迁移 session，而是换新家从零开始。**
> 旧 workspace 的旧 session 原地保留，不迁；账号在新 workspace 下重开全新 session。

opencode 原生约束就是"session 跟着 directory 走"（创建强制绑 `directory`、列 session 按 directory 过滤、server 多 instance 按 directory 分），顺着它走最稳。

---

## 三、最终决策清单（user 2026-06-07 逐条拍板，锁定）

| 项 | 决定 |
|---|---|
| **定位** | workspace = 账号专用真实项目目录，目的是飞书 Agent 远程开发，**权限给够、不收紧** |
| **A1 安全档** | 沿用 imbot v3 极简档（不收紧）；敏感读取 / 不可逆操作 → 发飞书卡片审批（保留这道闸）；GUI 加显眼安全提示 |
| **A2 并发** | 不处理，user 自己控制不同时编辑同一文件 |
| **A4 项目 `.opencode/` 激活** | 是目的不是问题，项目级 MCP/tool/imbot override 都生效 = 远程开发能力 |
| **P1 输入方式** | GUI 文件夹选择器（Tauri dialog） |
| **P2 文件落点** | 根目录 `_deskfox/`（下划线前缀，可见不隐藏），按 IM 分子目录；首次写入自动往项目 `.gitignore` 追加 `_deskfox/` |
| **P3 默认值** | 没配 workspace → 沿用全局 `imbot-workspace` home base（老账号 0 迁移） |
| **P4 改目录提示** | GUI 显示："对话记忆跟着工作目录走——换目录会开启全新对话，旧对话留在原目录。" |
| **P5 基数** | 允许多账号绑同一 workspace，**不加任何提示** |
| **全局默认结构** | 全局 home base 也统一改用 `_deskfox/feishu/{files,images}` 结构；旧 flat `feishu-files`/`feishu-images` 文件孤立不管（临时收件文件，价值低） |

### 目录结构（`_deskfox/` 约定）
```
<workspace>/                  ← 账号绑定的真实项目（或全局 imbot-workspace）
├─ _deskfox/                  ← 排序靠顶、可见、自动进 .gitignore
│  └─ feishu/
│     ├─ files/               ← 飞书发来的文件
│     └─ images/              ← 飞书发来的图片
└─ <真实项目内容>             ← bot 直接在这干活
```
未来接 telegram → `_deskfox/telegram/...`，项目根永远只多 `_deskfox/` 一个文件夹。

---

## 四、改动清单

| # | 改动 | 文件 |
|---|---|---|
| 1 | `FeishuAccountSchema` 加 `workspace?: z.string().optional()` | `core/config-schema.ts` |
| 2 | 抽 `private workspaceDir()` helper（`account.workspace ?? IMBOT_WORKSPACE`），替换 ~9 处 `query.directory` + PermissionCardController `workspaceDir` + ATTACH 白名单根 | `feishu/message-pipeline.ts` |
| 3 | 文件存储 default 改 `<workspace>/_deskfox/feishu/files` | `feishu/message-pipeline.ts` |
| 4 | `downloadFeishuImage` 加 `imagesRoot` 可选参，越界保护对它重算；callsite 传 `<workspace>/_deskfox/feishu/images` | `feishu/image-downloader.ts` + callsite |
| 5 | `ensureDeskfoxDir(workspaceRoot)` helper：mkdir `_deskfox/` + 幂等往 `.gitignore` 追加 `_deskfox/` | 新文件 `feishu/deskfox-dir.ts`（fork-only） |
| 6 | `updateAccountSettings` patch 加 `workspace?: string` | `feishu/account-store.ts` |
| 7 | `/accounts/update-settings`：allowed set + 类型校验 + patch 构造 + empty-patch 判断加 workspace | `server.ts` |
| 8 | list-accounts wire 回 `workspace`（GUI 回显当前值） | `server.ts` + `feishu/account-store.ts` |
| 9 | Rust：`UpdateAccountSettingsRequest`/wire/`ListAccountWireItem`/`AccountSummary` 加 workspace + 新命令 `feishu_pick_workspace_dir`（dialog 插件选目录） | `desktop/src-tauri/src/feishu_adapter.rs` + `lib.rs` 注册 |
| 10 | TS util：`UpdateAccountSettingsPatch` + `AccountSummary` 加 workspace + `feishuPickWorkspaceDir()` | `app/src/utils/feishu-config.ts` |
| 11 | GUI 弹窗：workspace 区块（当前值 + 选择器按钮 + P4 提示 + A1 安全提示） | `app/src/components/feishu-edit-account-dialog.tsx` + i18n |

**改 workspace hot 生效机制**：`/accounts/update-settings` → `onAccountsChanged` → `syncAccounts` **重建 pipeline**（plugin.ts 现成）→ 新 pipeline 带新 `account.workspace` + 内存 `chatToSession` 清空 → 下条消息自动 `session.create` 到新 directory。**无需删 chatSessionStore 映射**（验证：`chatSessionStore.get` 从未被调用，复用只读内存 map，pipeline 重建已清空）。

---

## 五、不做（明确排除）

- 不收紧安全档（A1）；不处理并发（A2）；不删 chatSessionStore 映射（重建已够）；不迁移旧 session/旧文件；多账号同 workspace 不告警（P5）。
- A5（改 workspace 时正好有 pending 权限卡片被孤立）：极低概率，v1 不处理，文档记录。

---

## 六、测试用例清单（R8，动工前列定，逐条可勾选）

> 层级：U=单元测试 / E=mock e2e / N=运行时·native 真桌面 QA（CDP 自测 ≠ 真桌面）

### Logic 清单（单元）—— ✅ 全过（adapter bun test 723 pass / 0 fail）
- [x] **T1 (U)** `config-schema`：account 带 `workspace` 字段能 parse；不带时 `workspace === undefined`（默认走全局）
- [x] **T2 (U)** `config-schema`：`workspace` 非 string（如 number）→ safeParse 返 error
- [x] **T3 (U)** `workspaceDir()` helper：`account.workspace` 设了返该值；未设返 `IMBOT_WORKSPACE`（用 session.create directory 捕获验证）
- [x] **T4 (U)** `downloadFeishuImage(imagesRoot=tmpDir)`：图片落盘到 `tmpDir/<chatId>/...`，不污染全局
- [x] **T5 (U)** `downloadFeishuImage` 越界保护：传 imagesRoot 后，`chatId` 含 `../` 仍被挡在 imagesRoot 子树内（用新 root 重算）
- [x] **T6 (U)** `ensureDeskfoxDir`：空项目 → 建 `_deskfox/` + `.gitignore` 含 `_deskfox/`；已有 `.gitignore` 不含 → 追加一行；已含 → 幂等不重复追加
- [x] **T7 (U)** `ensureDeskfoxDir`：已有 `.gitignore` 末尾无换行 → 追加前补换行，不破坏原有内容
- [x] **T8 (U)** `updateAccountSettings({workspace})`：写入 config 后 `account.workspace` === 传入值；白名单拒绝未知字段不变
- [x] **T9 (U)** `updateAccountSettings`：workspace 为空字符串 `""` → 清除走默认
- [x] **T10 (U)** server `/accounts/update-settings`：带 `workspace` 进 allowed set，非 string 返 `invalid_field`；只传 workspace 不算 empty_patch
- [~] **T11 (U→N)** list-accounts wire 回 `workspace`：server 无 configPath 注入难纯单测，降级真机 QA（T14/T15 端到端覆盖）+ 代码一行映射

### View 清单（mock e2e / 真桌面）—— ⏳ 待 user 真机 QA
- [ ] **T12 (E/N)** GUI 弹窗显示 workspace 区块：当前值正确回显（设过显路径，没设显"默认 home base"）
- [ ] **T13 (N)** 点"选择文件夹"→ 弹原生目录选择器 → 选中后路径回填（native，必真桌面验）
- [ ] **T14 (N)** 保存后 hot 生效：飞书该账号下条消息的 session 落在新 workspace（真机：发消息 → 看 sidecar log `session.create directory=<新路径>` + `_deskfox/feishu/` 出现在新项目）
- [ ] **T15 (N)** 收文件/图片落到 `<新workspace>/_deskfox/feishu/{files,images}`，且新项目 `.gitignore` 含 `_deskfox/`（真机端到端）
- [ ] **T16 (N)** ATTACH 发回：agent 在新 workspace 产出的文件能成功 ATTACH 回飞书（白名单根跟着走）
- [ ] **T17 (E/N)** P4 提示文案 + A1 安全提示在弹窗可见

### 回归 —— ✅
- [x] **T18 (U)** 旧 `downloadFeishuImage`（不传 imagesRoot）行为不变（向后兼容，落全局）—— 既有 image-downloader.test.ts 全绿
- [x] **T19 (U)** 既有 message-pipeline / account-store / server / config-schema 测试全绿（723 pass）
- [x] **T20 (build)** Rust：`cargo check` 通过 0 新增 warning + release exe build 成功（无 feishu_adapter 单测，靠编译 + 集成 build 验证）

---

## 七、风险点

- **运行时·native**：T13/T14/T15/T16 都是真桌面才能验的（原生目录选择器 + 真 sidecar + 真飞书消息 + 真 ATTACH），CDP 自测覆盖不了，必须真机 QA。
- **路径校验**：folder picker 保证存在性；但 workspace 为空串 / 手动改 config 填非法路径的兜底按 T9 定（空串=清除走默认）。
