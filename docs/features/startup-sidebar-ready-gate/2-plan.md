---
feat-id: startup-sidebar-ready-gate
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 2-plan — 启动期 sidebar ready gate 实施

## 决策 D1:ready 语义反了 — 顺手修正,不留双反代码

发现 `global-sync.tsx:84` `get ready() { return bootstrap.isPending }`:

- `isPending` 加载中 true、完成 false
- 字段名 "ready" 暗示就绪时 true,**实际相反**

唯一 callsite `layout.tsx:474` `if (!globalSync.ready) return` 字面意图"没就绪就 return",配合反语义实际行为是"加载完才 return,加载中跑" — icon enrichment 反在加载期间跑,bug。

**修法**:`return !bootstrap.isPending`,callsite 语义自动正确。home.tsx `<Match when={!sync.ready}>` 也跟着字面意图工作("loading 时显示加载文案",修正前加载完反而显示)。

## 决策 D2:gate 用纯函数 helper,不在组件内 inline

抽 `ready-gate.ts`:

```ts
shouldGateProjectTile(bootReady, selected) → boolean   // 视觉 gate
shouldSkipProjectNavigate(bootReady, selected) → boolean // 功能拦截
```

- 同源规则(目前函数体相同),但两个函数表达两个意图,callsite 可选择性用任一
- 纯函数 → 进 R5 v3.1 Logic 清单 → 7 个 unit case 覆盖 4 个状态组合

## 决策 D3:已选 tile 不 gate(toggle sidebar 是 0 HTTP)

```ts
onClick={() => {
  props.setOpen(false)
  if (props.selected()) {
    layout.sidebar.toggle()  // 0 HTTP,启动期也允许
    return
  }
  if (shouldSkipProjectNavigate(...)) return
  props.navigateToProject(...)
}}
```

视觉同步:`opacity-60 cursor-wait` 也只在 `!bootReady && !selected` 时生效,已选 tile 启动期保持正常 visual。

## 决策 D4:visual gate 用 opacity-60 + cursor-wait + aria-busy 三联

- `opacity-60` — 视觉信号"半透明 = 启动中"(transition-colors 已有,变化平滑)
- `cursor-wait` — 鼠标 hover 时小沙漏图标,告诉用户"等"
- `aria-busy="true"` — a11y / 自动化测试 hook

不加 tooltip "Starting..." 文字 — opacity + cursor 已是常规等待信号,文字反而干扰。

## 验证

- 7 unit pass(`ready-gate.test.ts`)
- typecheck 17/17 pass
- 真桌面 + CDP 检查:12 个 tile 全部正确渲染 `aria-busy` 属性(wiring OK)
- 本机冷启动 ~3s 就 bootstrap 完成,gate 视觉态窗口短(但慢机器 / child bootstrap 场景会更明显)

## 关联

- backlog 源:[`OPENCODE-PLAN/需求池/启动期-sidebar-点击无响应.md`](file:../../../../../OPENCODE-PLAN/需求池/启动期-sidebar-点击无响应.md)— 本 feat 完成后该 backlog 可标 done
- 顺手修的 `ready` 语义 bug:可能影响 home.tsx loading display 时机(修正后:加载中显示 loading 文案,完成才显示 list/empty)
