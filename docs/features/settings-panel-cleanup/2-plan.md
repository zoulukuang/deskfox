feat-id: settings-panel-cleanup
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 2-plan — 实施计划 + 决策轨迹

## 实施顺序

1. 任务 1/2(删 UI)→ 2. 任务 3(i18n 补译)→ 3. 任务 4(标题栏终端按钮)→ 4. 任务 5(原生菜单 i18n,最复杂)→ 5. typecheck + 单测 + 新测 → 6. 真机 QA。

## 关键决策轨迹

### D1 — 删 UI 只删展示,不动底层字段(任务 1/2)
5 项「高级」开关 + newLayoutDesigns 的 store 字段 / 默认值 **保留不动**,只删 `settings-general.tsx` 的渲染。
- 理由:文件树默认开、其余默认关、newLayoutDesigns 默认 `false`(经典布局)——删开关后这些默认行为正是当前用户所见,零回归。改默认值反而有风险(newLayoutDesigns 有 39 处消费,默认翻 true 会切到未支持的 v2 布局)。
- 清理:newLayoutDesigns 的 onChange 是 `dialog` 的唯一消费点,删后 `const dialog = useDialog()` + import 变 unused → 一并移除(否则 typecheck noUnusedLocals 报错)。

### D2 — 「打开终端」= 集成终端,全局安全触发(任务 4,user 拍板)
- user 选「应用内集成终端」(非系统 Terminal.app)。
- 触发用 `command.trigger("terminal.toggle")`:`run()` 对未注册命令是安全 no-op(`optionMap().get(id)?.onSelect?.()`),`command.keybind()` 从 catalog 读快捷键即使命令未注册也能显示 → 全局调用安全。
- 显隐:gate 在 `params.dir`(项目已打开),与既有「新建会话」按钮一致;集成终端本就 session 作用域,无项目时隐藏避免死按钮。
- 放在**经典标题栏** `ChannelIndicator`(DEV 徽标)前(line 603 处)——user 默认经典布局,截图即此处;v2 标题栏(已隐藏)不加。

### D3 — 原生菜单 i18n:渲染进程推 locale → 主进程重建(任务 5)
- 约束:macOS 原生菜单在**主进程**启动时一次性构建(英文),拿不到前端 i18n;系统 `role` 项(About/Hide/Quit)由 macOS 按**系统语言**本地化,不跟应用语言。
- 方案:menu.ts 保留 `deps`+`locale` 模块态 + `setMenuLocale()` 可重建;渲染进程 `Inner()` 用 `useLanguage()` + `createEffect` 监听 locale,经新 IPC `set-menu-locale` 推回主进程触发重建。复用 fork 既有 `desktop-menu-i18n.ts` 的 `translateMenuLabel`(P3,Windows 菜单已在用)。
- **做透 role 项**(否则半中半英更难看):Electron 支持 `{ role, label }` 共存(label 管显示、role 管行为)→ 带 label 的 role 项(Undo/Copy/缩放…)用翻译表覆盖;纯系统 role(About/Hide/Quit…)在主进程按 role 给带 `app.getName()` 的译名。
- **零回归保证**:`translatedLabel()` 仅当「译后 ≠ 原英文」才返回译文,否则 undefined → 退回原生标签(系统语言)。英文/未翻译语言下完全等价上游。

### D4 — 胶水留在 fork(desktop)包,最小上游侵入
- 监听 locale 的 effect 放 desktop 包 `renderer/index.tsx`(fork-only),不污染 app 核心的 language context。
- 仅需上游 app 加 1 行导出 `useLanguage`(`index.ts`,additive)+ package.json 加 `./desktop-menu-i18n` 子路径导出(指向 fork-only 文件)。

## 风险与回退

- 全部 fork-only 新增 / 既有 fork 文件改动 / additive 导出;无黑名单文件,**0 R4 override**。
- 回退:`git revert` 单笔即可;UI 删除恢复、菜单退回英文、终端按钮消失,无数据迁移。
