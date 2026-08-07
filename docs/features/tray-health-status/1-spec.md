feat-id: tray-health-status
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# REQ-099 托盘图标不反映后台健康状态

> 来源:`OPENCODE-PLAN/需求计划/2026-08-07.md`(小成本确定性收口批,IN SCOPE 第 3 条)
> 规模:**Medium**(纯函数 + 接线 + 图标生成脚本 + 单测 + 真机抽查)
> 核查基线:fork HEAD `26511dc6b4`(main)

## 需求

sidecar(AI 后台服务)崩溃 → 看门狗重启 → 熔断放弃,这条链路已经存在且会广播状态,但**托盘毫无表示**。用户关窗到托盘后,应用是"在重启"还是"已经放弃了"完全看不出来,只能靠回到窗口发请求失败才发现。看门狗这套基础设施已经付费建成,差的就是最后一根线。

## 现状(源码复核,已独立复验)

| 事实 | 位置 |
|---|---|
| 看门狗状态 **3 态**:`"restarting" \| "ready" \| "gave-up"` | `packages/desktop/src/main/deskfox/sidecar-watchdog.ts:20` |
| 广播只发给 renderer,不碰托盘 | `packages/desktop/src/main/index.ts:435` `emit: (status) => mainWindow?.webContents.send("deskfox:sidecar-watchdog", { status })` |
| **`memory-pressure` 不是看门狗发的**,来自 memory-brake 另一条线(同一 IPC 通道) | `index.ts:408` |
| renderer 侧已有消费方(toast) | `packages/app/src/utils/sidecar-health.ts` + `components/sidecar-health-monitor.tsx` |
| 托盘就在**主进程** | `index.ts:466` `createTray()` |
| 托盘图标是**内联 base64 常量**,不是运行时读文件 | `tray.ts` `TRAY_ICON_PNG_BASE64` / `TRAY_ICON_MAC_TEMPLATE_BASE64` |
| `packages/branding/src/assets/tray-icons/` 四个 PNG **md5 完全相同**(`d625fd03…`),且命名语义是飞书连接态,不是 sidecar 健康态 | 已 md5 复验 |

→ 接线**不需要新 IPC、不经 renderer**:在 `index.ts` 那个 `emit` 回调里直接调 `setTrayStatus` 即可。

## 🐛 顺带查出的真 bug:`setTrayStatus` 自覆盖(预留接口"调了也没用")

`tray.ts` 现状:

```ts
export function setTrayStatus(label: string): void {
  if (statusItem) statusItem.label = label
  if (tray) tray.setContextMenu(buildMenu())   // ← buildMenu() 从模板重建
}
```

而 `buildMenu()` 里 status 项 label **写死 `"状态:就绪"`** 并**重新给 `statusItem` 赋值** → 刚设的 label 当场被覆盖。所以就算现在有人调 `setTrayStatus("状态:重启中")`,菜单上也永远显示"就绪"。

**修法**:提一个模块级 `currentStatusLabel`(默认 `"状态:就绪"`),`buildMenu()` 读它;`setTrayStatus` 先写变量再重建菜单。

## ⚠️ 图标约束:mac template 只保留 alpha(不注意会白做)

macOS 走 `setTemplateImage(true)`(`tray.ts:88`),系统**只用 alpha 通道,颜色全部丢弃**。实测教训:用**白色**画的「!」徽标在 template 版被抹成黑色 → 与 restarting 版产出**完全相同的 PNG**(md5 一致),两态无法区分。

**正确做法**:徽标用单条 `fill-rule="evenodd"` path,把内部形状**挖成透明洞** —— 差异存在于 alpha 层,彩色模式与 template 模式下都成立。

三态设计:

| 状态 | 图形 | 颜色(仅彩色模式可见) |
|---|---|---|
| `ok`(ready) | 现有狐狸图形,不变 | 品牌深蓝 `#3D63A0` |
| `restarting` | 狐狸 + 右下角**实心圆点** | 琥珀 `#D08A1E` |
| `gave-up` | 狐狸 + 圆点内**挖出感叹号**(透明洞) | 红 `#C0392B` |

## 方案(定稿)

1. **修自覆盖 bug**:模块级 `currentStatusLabel` + `buildMenu()` 读它。
2. **抽纯函数**:新增 `packages/desktop/src/main/deskfox/tray-status.ts`,`mapWatchdogStatusToTray(status)` → `{ label, icon: "ok" | "restarting" | "gave-up" } | undefined`(对齐 `packages/app/src/utils/sidecar-health.ts` 的做法,逻辑可单测、`tray.ts` 只做展示)。
3. **接线**:`index.ts` 的 watchdog `emit` 回调里,在现有 `webContents.send` 之后追加 `setTrayStatus(status)`;`setTrayStatus` 内部同时更新**菜单文案**与**托盘图标**(`tray.setImage`)。
4. **图标生成**:脚本从源 SVG/基图产出三态 × 两模式 PNG,并生成 **base64 常量 TS 模块**(保持 `tray.ts` 现有"运行时无文件 IO、dev/打包一致"的性质);产物 PNG 同时落 `packages/branding/src/assets/tray-icons/status/` 供人眼审阅与回归 md5 断言。

## 测试用例清单(R8,动工前锁定)

| # | 用例 | 层级 | 预期 |
|---|---|---|---|
| T1 | 连续 `setTrayStatus` 两次,读菜单 status 项文案 | unit(desktop) | 等于**最后一次**的值(bug-repro:修前恒为"状态:就绪") |
| T2 | `mapWatchdogStatusToTray("restarting" / "ready" / "gave-up")` | unit | 3 态各返对应 label + icon key,互不相同 |
| T3 | `mapWatchdogStatusToTray("memory-pressure")` 及未知值 | unit | 返 `undefined`(不改托盘),不抛异常 |
| T4 | 三态 PNG(**彩色**模式)两两 md5 | unit(branding) | 互不相同 |
| T5 | 三态 PNG(**mac template / alpha-only**)两两 md5 | unit(branding) | 互不相同(防再次出现"四张同一图") |
| T6 | 生成脚本可重复执行 | 手动 | 二次运行产物 md5 稳定(可重现) |
| T7 | 真机:kill sidecar → 托盘切"重启中" → 恢复后回"就绪" | 真机(macOS) | 图标 + 菜单文案都跟着变 |
| T8 | 真机:连续秒杀触发熔断(120s 内 >5 次) | 真机(macOS) | 进入显著可辨的"已放弃"态 |
| T9 | 图标观感人眼抽查 | 真机(macOS 深/浅色菜单栏各一) | 缩到托盘尺寸肉眼可辨,不糊 |
| T10 | Windows 托盘彩色图标 | 真机(Win 端,可延后) | 三态可辨;延后则在 changelog 记未验 |

## 验收标准

- [ ] T1 bug-repro 单测入库并全绿(修前红)
- [ ] T2/T3 映射纯函数单测全绿
- [ ] T4/T5 图标差异化 md5 断言全绿
- [ ] T7/T8 macOS 真机通过
- [ ] T9 人眼抽查通过(深/浅色菜单栏各一)
- [ ] commit 带 `[feat: tray-health-status]`,fix 部分带 `[bug-repro: setTrayStatus 重建菜单时把刚设的 label 覆盖回"就绪"]`

## 治理约束

- **不触黑名单**:`packages/desktop/`(除 `src-tauri/` 若干子路径外)、`packages/branding/` 均不在 pre-commit 黑名单 → 本 feat **无需 R4 override**。
- `tray.ts` / `sidecar-watchdog.ts` 均为 FORK-ONLY 文件,改动不需要 FORK marker(但新文件保留 `// FORK-ONLY:` 头注释惯例)。
- **不新增运行时依赖**:图标生成用生成期工具(见 2-plan),避免改 `package.json` / `bun.lock`(两者都在黑名单,会平白多一笔 override)。

## 边界 / 明确不做

- **不做**"开机自启 / 静默托盘常驻"(REQ-027 补丁 4/5,退出条件是 IM 桥接排期时合并)—— 本条只做**状态可见**。
- **不做**周期性预防重启、可观测性面板(REQ-027 补丁 6 / 缺口 1,已标死不做)。
- **不接 `memory-pressure` 到托盘**:它来自 memory-brake 另一条线,语义是"压力预警"而非"服务不可用";映射函数对它返 `undefined` 预留接线口,要做另立。
- 不改飞书连接态那套 `default/connected/offline/error` 图标命名(语义不同,留给 Phase 4)。
