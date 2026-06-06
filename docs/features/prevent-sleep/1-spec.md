---
feat-id: prevent-sleep
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

> 审签:user 2026-06-06 拍板 ① 范围只做防休眠开关(自启动另立)② 开关默认关 ③ native 边界不做 UI 提示,仅文档内部记录。
---

# 1-spec — 防止电脑休眠(保障飞书远程随时可用)

## 背景 / 问题

DeskFox 现在是常驻服务:飞书消息通过**官方 SDK 的 WSS 长连接**(`adapter-feishu-lark/src/feishu/wss-client.ts`,`autoReconnect: true`)推到本地,DeskFox 主动出连飞书云(`open.feishu.cn:443`),不需要公网 IP / 端口映射 / 入站放行。

进程层 DeskFox 已经做得很好:关窗缩托盘不退进程(`lib.rs:556`)、sidecar 崩了 watchdog 自动重启(`server.rs`)、连接断了 SDK 自动重连。

**但操作系统层完全没管**:全代码库搜 `SetThreadExecutionState` / `keepawake` / `IOPMAssertion` / `powerSaveBlocker` = **0 命中**。电脑一旦进入系统休眠,CPU 停转、网卡断电 → WSS 长连接断开 → 用户此时通过飞书发消息**电脑根本收不到**,造成"人在远端发消息,bot 不回"。

> 关键认知:用户要的"远程使用"不是别人连进电脑,而是 DeskFox 自己挂在飞书云上。所以保障可用 = **别让电脑睡着把这条长连接掐了**。

## 目标

给用户一个**开关**:打开后,只要 DeskFox 在运行(哪怕缩在托盘),就持续阻止系统休眠;**允许屏幕正常关闭**(省电、护屏),只是系统不睡。开关是**持久化偏好**——开一次,以后每次启动默认保持开启状态,直到用户手动关掉。

## 非目标(本次明确不做)

- **不做开机自启动**(user 2026-06-06 拍板:先只做防休眠,自启动作为同目标第二步另立 feat)。
- **不做"智能按连接触发"**(已论证否决:检测到连接才防休眠是逻辑死结——电脑睡了就收不到连接,永远触发不了)。
- **不做网卡 / WiFi 省电控制**(系统不睡时网卡通常活跃;偶发断连由 SDK `autoReconnect` 兜底)。
- **不改飞书 adapter 连接逻辑**(SDK 自带重连 + 心跳已够)。
- **不做托盘菜单 i18n**(托盘是 Rust 端,现有 4 项均硬编码中文,新增项沿用现状,Rust 端 i18n 是独立议题)。
- **不做 native 边界的 UI 提示**(user 拍板:边界只留文档内部记录,界面保持干净,不堆免责文字)。

## 方案

### 归属:挂在「飞书桥接」设置栏目(user 拍板)

防休眠当前唯一服务的场景就是飞书远程常驻,故开关放飞书设置页(`settings-feishu.tsx`,已是 FORK 文件)。**好处:前端改动零上游侵入。** 备注:技术上它是全局行为,将来若出现别的远程场景再"提升"到通用层,现在不超前设计。

### 真相源:Rust 端(启动时能恢复)

防休眠是系统级行为且要"启动即恢复",故状态真相源放 Rust 端;前端 / 托盘都通过 Tauri command 读写同一状态。

### 四块改动

| # | 改动 | 文件 | 侵入性 |
|---|---|---|---|
| ① 防休眠核心 | **新建** `prevent_sleep.rs`:封装 enable/disable,持有 RAII guard(drop 即释放),幂等 | fork-only 新文件 |
| ② command + 启动恢复 | `lib.rs`:注册 `set_prevent_sleep`/`get_prevent_sleep` command + 启动读持久化状态并恢复 | **唯一上游侵入,≤10 行 + FORK marker** |
| ③ 托盘勾选项 | `system_tray.rs`:加 `CheckMenuItem`「保持电脑不休眠」,紧挨"暂停飞书桥接";on_menu_event 调同一逻辑 + 更新勾选 | fork-only(托盘是 fork 模块) |
| ④ 设置开关 | `settings-feishu.tsx`:加 `Switch` row(标题"保持电脑不休眠",副说明"屏幕可关、确保飞书消息随时响应"),走 i18n | fork-only |

- **依赖**:`Cargo.toml` 加 `keepawake`(R2 例外,仅加依赖免 marker)。
- **持久化**:用已有的 `tauri-plugin-store` 存 `prevent_sleep_enabled` 布尔(前后端皆可访问)。

### 技术选型:keepawake crate

跨平台一次覆盖 Win/Mac/Linux,且能精确表达"系统不睡 + 屏幕可关":配置 `display=false`(允许关屏)+ `idle=true`(阻止空闲休眠)+ `sleep=true`(阻止显式休眠)。

| 系统 | keepawake 底层 |
|---|---|
| Windows | `SetThreadExecutionState(ES_CONTINUOUS \| ES_SYSTEM_REQUIRED)` |
| macOS | IOKit `IOPMAssertion`(PreventUserIdleSystemSleep) |
| Linux | systemd-logind / D-Bus Inhibit |

(备选 `tauri-plugin-keepawake`,但引入插件体系,不如新模块自封装可控,故选直接用 crate。)

### 状态同步(两处入口一个真相源)

- 设置页 Switch `onChange` / 托盘 CheckMenuItem click → 都调 `set_prevent_sleep(bool)` → Rust 切换 guard + 写 store + **emit `deskfox-prevent-sleep-changed` event**。
- 前端监听该 event 更新 Switch;Rust 更新托盘 CheckMenuItem 勾选 → 两入口永远一致。

## 验收标准

- [ ] 设置页「飞书桥接」栏目出现"保持电脑不休眠"开关,默认关。
- [ ] 打开开关:系统空闲超过休眠时限**不进入休眠**;**屏幕仍能正常关闭**。
- [ ] 关闭开关:系统恢复正常休眠行为(guard 释放)。
- [ ] 重启 DeskFox:开关状态被记住并恢复(开着仍开着,且立即生效)。
- [ ] 托盘 CheckMenuItem 与设置页开关**双向同步**,勾选状态一致。
- [ ] 纯 fork 加法:除 `lib.rs` ≤10 行注入(FORK marker)外,全 fork-only。
- [ ] 核心逻辑单测覆盖(R5 Medium ≥3 unit)。
- [ ] 已知 native 边界(下文)真机 QA 确认行为(仅文档记录,不做 UI 提示)。

## R8 测试用例清单(动工前定,逐条可勾选)

### A. Rust 单元测试(Logic 清单)
- [ ] A1 `enable()` 后 guard 存在(状态=on);`disable()` 后 guard 释放(状态=off)。
- [ ] A2 重复 `enable()` 幂等——不重复创建 guard,状态稳定。
- [ ] A3 持久化:`set(true)` 写入 store;模拟启动 `load` 读回 true 并触发 enable。
- [ ] A4 `get_prevent_sleep()` 返回与内部状态一致。

### B. 前端单元 / Phase 1 mock e2e(View 清单)
- [ ] B1 设置页飞书栏目渲染出开关,初值反映 `get_prevent_sleep`(mock)。
- [ ] B2 切换开关调用 `set_prevent_sleep`(mock invoke 被调用,传参正确)。
- [ ] B3 收到 `deskfox-prevent-sleep-changed` event 时开关 UI 跟随更新(托盘改→设置页同步)。

### C. 运行时 · native 风险点(⚠️ CDP/自动化测不了,必须真机 QA)
> 对照治理 [[feedback_cdp_selftest_complements_not_replaces_qa]]:CDP 只能验"command 被调用",验不了"系统真的没睡"。以下逐条真机走查:
- [ ] C1 开启后,设短休眠时限(如 1 分钟)+ 不碰电脑 → 系统**不休眠**(真机,台式/插电笔记本)。
- [ ] C2 开启后,屏幕到点**正常关闭**(不被一起钉亮)。
- [ ] C3 开启 + 让屏幕关 + 等待 → 从飞书发消息,bot **能响应**(端到端真机)。
- [ ] C4 关闭开关 → 系统恢复能正常休眠。
- [ ] C5 重启 DeskFox → 开关状态恢复且立即生效。
- [ ] C6 ⚠️ **Modern Standby + 电池供电**机型:验证行为(keepawake 文档明确此场景防休眠可能被系统忽略)——确认是否需给用户提示。
- [ ] C7 macOS 端真机验证(如有环境);Linux 端验证(如有环境)。

## 已知边界(⚠️ 仅文档内部记录,不做 UI 提示 — user 拍板)

> 用途:排查"防休眠没生效"时有据可查;**不**暴露给终端用户,设置项副说明保持干净。

1. **Windows 现代待机(Modern Standby)+ 电池供电**:系统会忽略/终止防休眠请求(keepawake 上游文档明确,OS 级限制不可绕)。笔记本远程常驻建议插电。
2. **笔记本合盖**:默认"合盖即睡"是 OS/BIOS 电源策略,本功能压不住。
3. **关机 / 断电 / 拔网线 / 路由器挂 / 断网**:超出软件能力范围。

## 改动规模

**Medium**:新 `prevent_sleep.rs` ~100 行 + `lib.rs` ≤10 行注入 + `system_tray.rs` ~30 行 + `settings-feishu.tsx` ~20 行 + i18n keys + Cargo.toml 依赖 + 三文档。fork 侵入面仅 `lib.rs` 少量,其余全 fork-only。
