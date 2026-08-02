feat-id: feishu-session-project-visibility
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# REQ-086 飞书 session 桌面端项目列表缺失

## 需求

飞书桥接建的 session 出现在全局会话列表,但不出现在桌面端对应项目的会话列表。用户感知:「飞书聊的内容在项目里找不到」。

## 根因(2026-08-02 源码复查实锤)

独立缺陷,与绑定什么模型无关。adapter 建 session 唯一路径 `message-pipeline.ts`(session.create)用 `directory = resolveWorkspace(account.workspace)`;账号未设 workspace 时回退全局 `~/.opencode/imbot-workspace`(`deskfox-dir.ts:23,40`)→ session 的 projectID 永不等于桌面已打开项目 → `Session.list scope=project` 按 project_id 过滤不可见。

毗邻发现(二次复核):`account-store.ts saveAccount` 重绑(re-OAuth)重建 account 对象时沿用清单漏了 `model` / `workspace` 两个字段 → **重绑一次就丢 per-account 模型与工作目录设置**。属同缺陷面,一并修。

## 方案(定稿)

1. 绑定新账号 OAuth 成功后,若当前有打开的项目且该账号未设 workspace → 自动把 workspace 默认为当前项目目录,并在成功页明示:会话将进该项目列表、飞书文件将落项目 `_deskfox/` 目录(自动 .gitignore)。
2. 无打开项目 / 账号已有 workspace(重绑)→ 不动,成功页分别提示「用全局默认,不进项目列表」/「沿用已有设置」。
3. 编辑对话框 workspace 为空时,显著提示「此账号的飞书会话不会出现在项目列表」。
4. `saveAccount` 重绑保留 `model` / `workspace`(bug fix)。
5. 存量无 workspace 账号不自动迁移(靠 3 的提示引导手动设置)。

## 测试用例(R8,动工前锁定)

| # | 用例 | 层级 | 预期 |
|---|---|---|---|
| T1 | `defaultWorkspaceForBind(dir, null)` | unit(app) | 返回 dir(注入默认) |
| T2 | `defaultWorkspaceForBind(dir, "已有路径")` | unit(app) | 返回 null(重绑不覆盖) |
| T3 | `defaultWorkspaceForBind(undefined/""/空白, null)` | unit(app) | 返回 null(无项目回退全局默认) |
| T4 | `defaultWorkspaceForBind("  /a/b  ", null)` | unit(app) | 返回 trim 后路径 |
| T5 | `saveAccount` 已有账号带 workspace+model 重绑 | unit(adapter,bug-repro) | 两字段保留 |
| T6 | `saveAccount` 新账号 | unit(adapter) | workspace/model 缺省(undefined) |
| T7 | 真机:飞书发消息 → 桌面对应项目列表出现 session 并可续聊 | 真机 QA(发版前) | 验收门槛 |
| T8 | 真机:编辑对话框清空 workspace → 出现「不进项目列表」提示 | 真机 QA | 验收门槛 |

## 运行时·native 风险点

- workspace 注入走已有 `feishuUpdateAccountSettings` 端点(best-effort,失败不阻断绑定,成功页降级为 fallback 提示);
- 「Cloud Code 形态才可见」为本机配置相关性假象,真机 A/B 复测一次(T7 覆盖);
- REQ-093 联动:plugin instance `ctx.directory` 须与 workspace 一致才收得到事件(blocker 级真机验证,见需求计划)。

## 影响范围

前端 `feishu-bind-dialog.tsx` / `feishu-edit-account-dialog.tsx` / 新 helper / i18n ×3;adapter `account-store.ts`(fork-only 包,非上游文件)。
