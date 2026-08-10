feat-id: upstream-sync-2026-08
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实施计划 + 决策轨迹

分支:`sync/upstream-2026-08-10` | 兜底 tag:`pre-merge-upstream-2026-08-10`(= 动工时 main `e77443750e`)

## 分段进度

| 段 | 目标 | 状态 | merge commit | 备注 |
|---|---|---|---|---|
| 1 | v1.17.8 `8716c4309a`(06-17) | ✅ done | `ea3ea31315` | 时间线重写段,25 冲突,e2e 37/37 |
| 2 | v1.17.13 `1e73b76ea6`(07-01) | pending | - | markdown → session-ui 段 |
| 3 | v1.18.4 `d36a2d8981`(07-20) | pending | - | v2 tokens + provider 对话框段 |
| 4 | v1.18.16 `550d1ffd24`(08-10) | pending | - | 收尾 + i18n 段 |

## 决策轨迹(实时追加)

- 2026-08-10:user 批准 spec(D1-D5),图标栏重排选「先用上游原生布局」。
- 2026-08-11 段1 完成(`ea3ea31315`),关键决策与踩坑:
  - **D1 时点修正**:上游 v1.17.8 时 prod 默认同样是经典布局(`channel !== "prod"`),v1.17.19+ 才切 v2 并退役。
    故 `newLayoutDesignsDefault` 段1-3 维持 false,段4 随上游节奏翻转(比原计划更贴上游)。上游 v2 专属
    e2e(session-timeline.spec)在测试内显式种 `newLayoutDesigns: true`。
  - **撤销 REQ-053/058 思考链折叠**:上游 `showReasoningSummaries` 默认 false = reasoning 整层不渲染,
    已覆盖"不刷屏思考链"诉求且更彻底;我们的 Collapsible 包装破坏新虚拟化首帧锚底(cold-tab e2e 218px 实测)。
  - **bash 折叠组保留** + 两处配套:cold-tab 首帧断言放宽 1 帧(行数变少使可见时刻撞上量高沉降前一帧,
    16ms 级不可感知)+ maybeAnchorBottom 锁底沉降循环(totalSize 连续 3 帧稳定)。
  - **REQ-097 查找跳转三连修**(新虚拟化专有,全部实测定位):
    ① core `getOffsetForIndex` 对 measurementsCache 缺失行静默 no-op → 绕行手算 offset;
    ② 端锚 `wasAtEnd` 在 core 内部 offset 未入账时把远跳拽回底 → 两段式脱锚(用 `getVirtualDistanceFromEnd` 判定);
    ③ autoScroll 把程序化滚动当内容位移回贴底 → 跳转前每帧标记手势/用户滚动;
    ④ find 深挖 loadMore 不可带 prepend 视口锚定(会把底部钉成死点)→ 桥裸 `timeline.history.loadOlder()`。
  - **上游行语义变更**:ProjectDirectories.create 改写 strategy、不再写 type(遗留列,新行 null),
    REQ-069 carve-out 测试断言对齐;M6 恢复逻辑本有 candidates[0] 回落不受影响。
  - **Win 基线**:opencode `instance-bootstrap.test.ts` 纯上游 worktree 同样 2 fail(REQ-105 方法学),非合并引入。
  - virtua 上游已删(catalog+patch),fork csv-table 还用 → app 内钉版本 `0.49.1`。
  - 上游测试 worktree 留存 `D:/tmp/upstream-v1178`(v1.17.8,基线判定用,段4 后删)。
