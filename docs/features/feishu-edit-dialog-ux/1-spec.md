feat-id: feishu-edit-dialog-ux
status: spec
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 飞书账号编辑弹窗 — 默认模型简化 + 身份/目录可见性

> 规模:**Medium**(单一主题:飞书账号 GUI 的"默认模型选择"心智简化 + 两处信息可见性增强;~250 行,跨前端/adapter/Rust 透传,几乎全 fork-only 文件)。
> 起源:2026-06-08 user 反馈编辑弹窗"跟随默认"勾选区交互复杂 + 顶部文案只有 accountId 难辨认 + 账号列表看不到 workspace 目录。

## 1. 需求(三 Ask)

### Ask ① 去掉"跟随默认"勾选,默认直接显示"自动免费模型"
- 移除弹窗里的"跟随 DeskFox 默认(推荐)"勾选框 + 其动态 hint 区。
- 提供商/模型两个下拉**始终可用**;首次进入(账号未设 model)即预选:
  - **提供商 = OpenCode Zen**(provider id `opencode`)
  - **模型 = "自动(免费模型)"** —— 一个特殊选项,语义:**永远使用 OpenCode Zen 当下免费模型列表里的第一个**(动态,opencode 明天换了免费模型也自动跟上,不会失效)。
- 用户可改成任意 provider/具体 model;不改就用"自动"。

### Ask ② 顶部文案带飞书账号名
- 现:`为飞书账号 cli_a959292d57f9dbce 设置对话模型 + 高级能力。`
- 改:`为飞书账号 <botName>(cli_xxx) 设置对话模型 + 高级能力。`(带 bot 名便于辨认,保留 id 精确定位;无 bot 名时回退纯 id)。

### Ask ③ 账号列表增加 workspace 目录行
- 列表每个账号(`settings-feishu` 卡片)在 openId/agent/model 行下,**增加一行显示该账号的 workspace 目录**。
- 未单独设 workspace 时,显示**全局默认的真实绝对路径**(`~/.opencode/imbot-workspace` 展开后,如 `C:\Users\yuexi\.opencode\imbot-workspace`),便于 user 直接定位文件夹 —— **不是**抽象的"默认 home base"字样。

## 2. 关键机制 / 架构选型(调研结论)

- **"自动免费模型"开箱即用、无需登录**:`provider.ts` 的 `opencode` provider effect 在未认证时自动**只保留免费模型**(`cost.input === 0`)+ 用 `apiKey:"public"` 公开访问(上游设计,无 FORK)。故全新用户绑完飞书账号即可用"自动",无需先连接 OpenCode Zen。
- **动态 = 运行时解析,不能保存时钉死**:用户要"第二天换了模型还能用",故保存的是**哨兵** `{providerID:"opencode", modelID:"__auto_free__"}`,而非具体 model id。pipeline 发请求**前**实时解析成当下第一个免费 model。
- **跟随全局默认(account.model=null)语义保留但不再是 GUI 入口**:存量 null 账号继续走全局默认;新建/保存默认走"自动免费"。两者后端都能处理,GUI 只暴露"自动 + 具体 model"。
- **workspaceEffective 由 adapter(Node,有 homedir)解析**:在 `/accounts` 列表响应回一个解析后的绝对路径字段,Rust 透传,前端直接显示(避免前端硬编码 `~` / 不知 home dir)。默认路径常量收口到 `deskfox-dir.ts` 单一真相源。

## 3. 改动范围(文件)

| 层 | 文件 | 改什么 | fork? |
|---|---|---|---|
| 前端 helper(新) | `app/.../feishu-edit-account-model.ts` | `AUTO_FREE_MODEL_ID` 常量 + `initialModelSelection` + `buildModelOptions` + `toModelPayload` 纯函数(Logic 清单) | 新文件 |
| 前端弹窗 | `app/.../feishu-edit-account-dialog.tsx` | Ask① 去勾选/默认自动 + Ask② 标题带 bot 名 | fork-only |
| 前端列表 | `app/.../settings-feishu.tsx` | Ask③ workspace 行 + 传 botName/workspaceEffective | fork-only |
| 前端类型 | `app/.../utils/feishu-config.ts` | `AccountSummary.workspace_effective` | fork-only |
| i18n | `app/src/i18n/{en,zh,zht}.ts` | 加 `autoFreeModel`(+hint);删 4 个 useDefault 死 key | en 上游(加 FORK 块) |
| adapter | `adapter-feishu-lark/.../deskfox-dir.ts` | 导出 `DEFAULT_IMBOT_WORKSPACE` + `resolveWorkspace` | fork-only |
| adapter | `adapter-feishu-lark/.../message-pipeline.ts` | 用 resolveWorkspace + `pickFirstFreeModel` + `effectiveModel`(哨兵解析,vision check 也走它) | fork-only |
| adapter | `adapter-feishu-lark/src/server.ts` | `/accounts` 回 `workspaceEffective` | fork-only |
| Rust | `desktop/.../feishu_adapter.rs` | wire + AccountSummary 加 `workspace_effective` 透传 | fork-only |

## 4. 验收标准 + 测试用例清单(R8 — 动工前列定,逐条可勾)

### Logic 单测(纯函数,可 bun test)

- [ ] **T1** `initialModelSelection(null)` → `{providerID:"opencode", modelID:"__auto_free__"}`(首次默认自动免费)— unit
- [ ] **T2** `initialModelSelection(哨兵)` → 原样返回(provider opencode + auto)— unit
- [ ] **T3** `initialModelSelection(钉死 {anthropic, claude-x})` → 原样返回(尊重已选)— unit
- [ ] **T4** `buildModelOptions("opencode", models, autoLabel)` → 第一项是 auto 选项,其后才是真实 models — unit
- [ ] **T5** `buildModelOptions("anthropic", models, autoLabel)` → **不含** auto 选项(自动只对 opencode)— unit
- [ ] **T6** `toModelPayload("opencode","__auto_free__")` → `{provider_id:"opencode", model_id:"__auto_free__"}`(哨兵原样存)— unit
- [ ] **T7** `pickFirstFreeModel(providersData)` 取 opencode 第一个 `cost.input===0` 的 model id;无免费 → null;无 opencode provider → null — unit
- [ ] **T8** `resolveWorkspace(undefined/null/"  ")` → `DEFAULT_IMBOT_WORKSPACE`;`resolveWorkspace(" /proj ")` → `/proj`(trim)— unit(扩 deskfox-dir.test.ts)

### View / 集成(infra 就绪后;当前阶段 Claude 自审 + CDP 自测)

- [ ] **T9** 弹窗首次打开(未设 model):提供商显示 OpenCode Zen、模型显示"自动(免费模型)"、无"跟随默认"勾选框 — View happy path
- [ ] **T10** 顶部文案显示 `<botName>(cli_xxx)`;无 bot 名账号回退纯 id — View
- [ ] **T11** 账号列表每卡显示 workspace 行;未设 = 全局默认绝对路径,已设 = 该真实目录 — View
- [ ] **T12** 选"自动"保存后,重开弹窗仍回显"自动"(哨兵往返不丢)— 集成

### 运行时 / native 风险点(对照"CDP 自测 ≠ 真桌面 QA",真机验)

- [ ] **T13** 真机:全新账号默认"自动",飞书发消息 → bot 用免费模型正常回复(验 `apiKey:"public"` 免登录链路真通)— 真桌面 QA
- [ ] **T14** 哨兵的 **vision 预检**不被误判:发图片给"自动"账号,不因 `__auto_free__` 查不到 model 而误判不支持 vision 卡住 — 真桌面 QA(effectiveModel 必须先解析再查 vision)
- [ ] **T15** 免费列表为空/离线兜底:`pickFirstFreeModel` 返 null 时回退全局默认(promptAsync 不带 model),不硬失败 — unit(T7 覆盖)+ 真机抽查

## 5. 不做 / 边界

- 不改 `provider.ts`(上游免费模型机制,只读不动)。
- 不动 account.model=null 的"跟随全局默认"语义(后端保留),仅 GUI 不再以勾选暴露。
- 不为"自动"加联网状态轮询/提示(解析失败静默回退即可)。
- 弹窗内 workspace 空态也顺带显示真实默认路径(复用 workspaceEffective,无新增成本)。
