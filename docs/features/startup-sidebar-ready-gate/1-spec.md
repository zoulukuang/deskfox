---
feat-id: startup-sidebar-ready-gate
status: spec
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 1-spec — 启动期 sidebar 项目切换无响应修复

> **规模:Medium**(预估 ~100 行代码 + 测试 + ~50 行 spec/plan/changelog)
> **起源**:[`OPENCODE-PLAN/需求池/启动期-sidebar-点击无响应.md`](file:../../../../../OPENCODE-PLAN/需求池/启动期-sidebar-点击无响应.md)(2026-05-28 user 反馈 + CDP 测试自身踩坑 2 次)。

## 背景

冷启动 DeskFox 几秒到十几秒内:
- ✅ 主窗口立刻可见,sidebar 项目图标渲染了
- ❌ 点项目图标 → 无视觉变化,**像无响应**
- ⏰ 等若干秒后,同样点击恢复正常

根因(详 backlog):Tauri 主窗口立刻 show,但 `globalSync.ready === false`(bootstrap.isPending)期间,event handler 绑了 + 下游 HTTP 调用全卡 + `.catch(() => [])` 兜底吞错 → user 视角"点了没动静"。

## 关键发现:`globalSync.ready` 语义反了(顺手修)

`packages/app/src/context/global-sync.tsx:84`:

```ts
get ready() {
  return bootstrap.isPending  // ❌ isPending 加载中 true,完成 false — 字段名"ready"暗示反过来
}
```

唯一 callsite `packages/app/src/context/layout.tsx:474`:

```ts
if (!globalSync.ready) return  // 字面意图: 没就绪就 return,但因 ready 反了,真实行为是"完成才 return"
```

这两处一起反着,某种意义上"看起来工作"(双反 = 正),但读者每次理解都要在脑里翻一次,极易写错下一个 callsite。本 feat 顺手修正 `ready` getter 语义到 `!bootstrap.isPending`(true = 就绪),`layout.tsx:474` 字面意图保持不变(没就绪就 return,加载完才设 icon),**实际行为反而修正**(原 bug:icon 只在加载中尝试设,加载完反而不设)。

## 目标

| 改动点 | 内容 |
|---|---|
| `global-sync.tsx:84` | `ready` getter 改 `!bootstrap.isPending`(就绪时 true)|
| `sidebar-project.tsx` ProjectTile | 加 `bootReady: Accessor<boolean>` prop。`!bootReady()` 时:① classList `opacity-60 cursor-wait`(视觉信号"启动中,稍候")② `aria-busy="true"`(a11y)③ 点击 guard `if (!bootReady()) return`(防 navigateToProject 撞 HTTP cold) |
| `sidebar-project.tsx` SortableProject | `useGlobalSync()` 读 `ready`,作 accessor 传给 ProjectTile |
| **不动 session 列表** | `sidebar-workspace.tsx:259` 已有 `<Show when={loading()}><SessionSkeleton /></Show>`,既有逻辑足够 |
| **不动 selected tile toggle** | 已选中的 tile 点击只 `layout.sidebar.toggle()`(纯前端 0 HTTP),不需要 gate |

## 非目标

- **不改** main window 立刻 show 的设计(`lib.rs:738-739` 注释明写"web app handles its own loading/health gate",我们正是在补这个 gate)
- **不加** "Starting..." 文字 tooltip(opacity + cursor 已是常规"等"信号,文字反而干扰)
- **不修** 整个 bootstrap 链路速度(sidecar 启动 + db migration 等都是别的 backlog)
- **不抽** 通用"ReadyGuard" 组件(就一处,过度抽)

## 验收标准

- [ ] 冷启动 DeskFox,sidebar 项目图标在 sidecar 就绪前显示 `opacity-60 cursor-wait`(视觉"启动中")
- [ ] 启动期点击项目图标 → 无 HTTP 触发(devtools Network 验)
- [ ] 启动期点击已选中的当前项目图标 → 仍正常 toggle sidebar(不被 gate 误拦)
- [ ] sidecar 就绪后,tile 立刻恢复正常 opacity + cursor + click 行为
- [ ] `globalSync.ready` 语义对齐字段名(true = 就绪)+ `layout.tsx:474` 字面行为保持("没就绪就 return")— project icon enrichment 实际首次 run 时机从"加载中"挪到"加载完",更稳
- [ ] unit 测试 ≥ 3 个(Medium 标准):① ProjectTile bootReady=false 时 classList 含 opacity-60 ② onClick 当 bootReady=false 不调 navigateToProject ③ 已选 tile + bootReady=false 仍能 toggle sidebar
- [ ] typecheck 17/17 pass
- [ ] release build 真桌面验证:冷启动前几秒图标视觉变化明显 + 启动完恢复

## 风险

| 风险 | 缓解 |
|---|---|
| `ready` 语义修正影响 layout.tsx:474 icon enrichment effect 时机 | 这是 bug fix:原行为"加载中跑、完成后跳"明显反了。修正后 effect 在加载完才跑一次,语义和直觉对齐。即使有边角 case 受影响,也是改对方向 |
| 项目 tile 视觉"opacity 闪一下"在快速启动场景突兀 | `transition-colors` 已在 classList,opacity 变化平滑 |
| 误把已选 tile 也 gate(toggle sidebar 失灵)| 测试用例 ③ 覆盖,onClick 里 `selected()` 分支在 bootReady 检查之前 |

## 关联

- backlog 源 [[OPENCODE-PLAN/需求池/启动期-sidebar-点击无响应]]
- memory `feedback_kill_deskfox_freely_during_dev` — 开发期重启 DeskFox 验证不用问授权
- 之前 `media-gen-xiaomi` 接入 feat CDP 测试时撞同问题(reload 25s 才 ready),反向验证本 backlog 真实
