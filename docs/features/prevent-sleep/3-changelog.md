---
feat-id: prevent-sleep
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 3-changelog — 防止电脑休眠

## 一句话

给 DeskFox 加「保持电脑不休眠」开关(飞书桥接设置栏目 + 系统托盘勾选项,双入口同步),开启后阻止系统休眠但**允许屏幕关闭**,状态持久化、每次启动自动恢复 —— 保障飞书远程 WSS 长连接不被休眠掐断、消息随时可响应。

## 实际改动

| 文件 | 类型 | 说明 |
|---|---|---|
| `packages/desktop/src-tauri/src/prevent_sleep.rs` | **新建** fork-only | 核心:常驻 worker 线程持有 keepawake guard(规避 Win per-thread ExecutionState 失效坑)+ store 持久化 + 启动恢复 + 2 个 Tauri command + 5 单测 |
| `packages/desktop/src-tauri/src/lib.rs` | 改上游 | mod 声明 1 行 + command 注册 2 行 + setup 启动恢复 5 行(全 FORK marker)|
| `packages/desktop/src-tauri/src/system_tray.rs` | fork 模块增订 | CheckMenuItem「保持电脑不休眠」+ 事件分支(取反切换)+ `set_prevent_sleep_check` 同步函数 |
| `packages/desktop/src-tauri/Cargo.toml` | 加依赖 | `keepawake = "0.6"`(R2 例外免 marker,加注释)|
| `packages/desktop/src-tauri/Cargo.lock` | 自动 | keepawake + derive_builder/darling/objc2-io-kit 等传递依赖 |
| `packages/app/src/components/settings-feishu.tsx` | fork 文件增订 | Switch 开关 + onMount 读初值 + listen `deskfox-prevent-sleep-changed` 同步(`.catch` 降级)+ 乐观更新/回滚 |
| `packages/app/src/i18n/{zh,zht,en}.ts` | fork 增订 | 各 +2 key(`settings.feishu.preventSleep.title/description`)|
| `packages/app/e2e/prevent-sleep.spec.ts` | **新建** fork-only | Phase 1 mock e2e 2 case:开关出现+初值+点击开启 / listen 降级无 fatal error |
| `packages/app/e2e/mocks/tauri.ts` | fork 增订 | mock dispatch 加 `get/set_prevent_sleep`(模块级状态闭环)|
| `docs/features/prevent-sleep/{1-spec,2-plan,3-changelog}.md` | 文档 | 三文档 |
| `docs/features/INDEX.md` | 文档 | 索引加一行 |

commit:本笔(grep `[feat: prevent-sleep]`)

## 架构要点(详见 2-plan 决策轨迹)

- **专用 worker 线程**:keepawake 在 Windows 直接在调用线程调 `SetThreadExecutionState`,而该状态 per-thread 且线程结束即失效;Tauri command 跑在会被回收的 tokio 线程池上不可靠。→ 常驻 worker 线程持有 guard,channel 投递 enable/disable。
- **真相源 Rust + 双入口 event 同步**:设置页 Switch ↔ 托盘 CheckMenuItem,任一切换经 `set_enabled` 统一处理(worker + 内存态 + 持久化 + 回写托盘勾选 + emit event)。
- **keepawake 配置** `display=false / idle=true / sleep=true` = 系统不睡、屏幕可关。
- **启动恢复走 app.store**(非硬编码 identifier),兼容 DeskFox 三档 bundle id override。
- **归属飞书设置栏目**:前端零上游侵入(settings-feishu.tsx 本是 FORK 文件)。

## 回归测试

- 前端 typecheck:**17/17 全过**
- Rust `cargo check`(dev)+ `cargo build --release`:**0 error**,新代码 0 warning(7-8 warning 全 pre-existing dead code)
- Rust 单测:tauri lib `cargo test` 撞 Win `0xc0000139`(DLL 通病,非逻辑问题)→ 抽 `enabled_from_store_value` 纯逻辑到独立临时 crate `cargo test` **5 passed**
- 前端 Phase 1 mock e2e:**prevent-sleep 2 case passed**;全套回归 **16 passed + 3 skipped(无回归)**
- release build:产出 `DeskFox.exe`(含 media-gen 插件打包 + tauri release)

## fork 健康

- 上游侵入:仅 `lib.rs` ~8 行(已 FORK marker);其余全 fork-only(新文件 + fork 模块/文件增订)
- 0 R4(无黑名单文件)
- R5:5 Rust 单测满足 Medium ≥3 unit 硬门槛

## 真机 QA(2026-06-06,user 机 Win11)

**已验证通过:**
- ✅ 开关开启 → 飞书远程沟通正常(防休眠生效)
- ✅ 屏幕能正常关闭(display=false 符合预期)
- ✅ 开关关闭 → guard 立即释放(日志 `[prevent-sleep] 已关闭,恢复正常休眠` 佐证,enable/disable 多轮切换精确生效)

**重要发现 — 本机为 S0「连接的网络」现代待机(不支持 S3):**
- `powercfg /a` 实测:仅 S0 低电量待机(连接网络)+ 休眠,**无 S3**。
- 现象:**关掉开关、黑屏后,飞书消息仍能回**。排查结论:S0「连接网络」待机时系统保持网络连接、周期唤醒收包,WSS 长连接可维持 → 与 DeskFox 无关(日志已证关开关后 guard 释放)。
- 产品含义:S0 机器"不开也有时能用"是系统**碰运气**(电池/低电量/网络策略会中断,即 spec 的 Modern Standby 边界);开关价值=把"碰运气"变"稳定不待机",且对 S3 老机器是刚需。

## code-review 修复(/code-review high effort,2026-06-06)

多 agent 审查(7 finder + verify)后修复:
- **#1 失败不再谎报(altitude)**:worker 改请求-回执模型,回报「guard 是否真持有」;`set_enabled` 以实际结果 `actual`(而非请求值)更新内存/托盘/前端;请求开启却没生效(OS 拒绝/硬失败)→ 返 Err,前端开关弹回。把原先「墙在 worker 线程里」的真实 guard 状态暴露出来。(注:现代待机+电池被 OS 忽略时 create 仍可能返 Ok,这层探测不了,属系统硬限制。)
- **#2 存盘顺序**:`persist` 移到最后且失败只 warn、不回退已生效的运行态,消除「存盘失败 → worker/内存 vs 托盘/前端 多方打架」;代价仅「重启后可能不恢复」。
- **#3 listen 失败记日志**:`onPreventSleepChanged` 注册失败 `console.warn`(不再静默 null)。
- **#4 worker send 失败**:线程已退出时 `set_enabled` 立即 Err,不谎报。
- **#6 前端 wrapper**:新建 `packages/app/src/utils/prevent-sleep.ts`(get/set/onChanged + 事件名常量),组件不再裸用 invoke,对齐 feishu-config.ts 惯例。
- **#7 store helper**:新建 `packages/desktop/src-tauri/src/settings_store.rs`(read_value/write),prevent_sleep 不再手抄 store 样板;linux_display 迁移留 follow-up(不动 Linux-only 代码)。
- **#10 静态 import**:event API 改静态 import(移入 wrapper)。

验证:cargo check 0 error / typecheck 17/17 / 纯逻辑 5 单测(未变)/ 全套 e2e 16 passed+3 skip 无回归。
未修(边际,记录在案):#5 onMount get/listen 窄竞态窗口、#8 启动重复 persist 同值、#9 单 bool 套 struct。

## 待办

- **真机 QA 未专门验**:C5 重启 DeskFox 后开关持久化恢复;设置页 ↔ 托盘双入口同步(实测时已顺带看,无自动化);Mac/Linux(无环境)。
- **B3 托盘 event 同步未自动化**:vite mock 只 alias core 不 alias event,Phase 1 测不了真 event;前端已 `.catch` 降级,e2e 第 2 case 验证了无 fatal error。
- **native 边界(仅文档记录,不做 UI 提示)**:Win 现代待机+电池供电防休眠被系统忽略;笔记本合盖默认睡;关机/断电/断网超出能力范围。

## 回退方法

`git revert` 本 commit 即可:删 keepawake 依赖 + prevent_sleep.rs + lib.rs 注入 + 托盘项 + 设置开关。各改动 P4 可逆、互不耦合产品其他功能。
