---
feat-id: prevent-sleep
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 2-plan — 防止电脑休眠 实施计划 + 决策轨迹

## 实施顺序

1. `prevent_sleep.rs` 核心模块(worker 线程 + 持久化 + command)
2. `Cargo.toml` 加 keepawake 依赖
3. `lib.rs` 注入(mod + command 注册 + 启动恢复)
4. `system_tray.rs` 加 CheckMenuItem + 事件分支 + 同步函数
5. `settings-feishu.tsx` 加 Switch + listen event
6. i18n(zh / zht / en)三档加 key
7. 验证:typecheck + cargo check + 单测 + release build

## 关键决策轨迹

### D1. keepawake crate vs 自己写 native(选 crate)
Windows 已有 `windows-sys` 依赖(含 `Win32_System_Threading`),本可零新依赖自写 `SetThreadExecutionState`。但 user 要求 Win/Mac/Linux 全覆盖,Mac(IOKit IOPMAssertion)/Linux(D-Bus logind inhibit)自写繁琐。`keepawake` 0.6 跨平台一次覆盖,且 `display/idle/sleep` 三档精确表达"系统不睡+屏幕可关"语义。契合元原则"稳定>简洁、复用成熟实现"。

### D2. 专用 worker 线程(规避 per-thread ExecutionState 坑)⚠️ 核心
查 keepawake 源码(`src/sys/windows.rs`)发现:Windows 实现是**直接在调用线程**调 `SetThreadExecutionState`,而该执行状态 **per-thread 且线程结束即失效**。Tauri command 跑在会被回收的 tokio 线程池上,直接持有 guard 不可靠。
→ 解法:常驻、不退出的 worker 线程持有 guard,enable/disable 经 `mpsc::channel` 投递,guard 创建/drop 都固定在该活线程。副作用利好:guard 只活在线程局部、从不跨线程移动,顺带绕开 `keepawake::KeepAwake` 非 Send 限制。

### D3. 真相源在 Rust + 双入口 event 同步
设置页 Switch 与托盘 CheckMenuItem 两个入口,真相源放 Rust(`AtomicBool` ENABLED + store 持久化)。任一入口切换 → `set_enabled()` 统一:投递 worker + 写内存 + 持久化 + `set_prevent_sleep_check()` 回写托盘勾选 + emit `deskfox-prevent-sleep-changed` → 前端 listen 更新 Switch。两入口永远一致。

### D4. 持久化复用 tauri-plugin-store(linux_display 范例)
`SETTINGS_STORE`("opencode.settings.dat")已有,`linux_display.rs` 已示范 `app.store().set/save`。新增顶层 key `preventSleepConfig`,不新建文件。

### D5. 启动恢复走 app.store 而非硬编码路径
`linux_display::read_wayland` 早期直读文件 + 硬编码 identifier(`ai.opencode.desktop`)。但 DeskFox 三档 bundle id 经 tauri-overrides 改成 `ai.deskfox.*`,硬编码会读错路径。→ `read_persisted(app)` 走 `app.store()` 自动定位正确路径,在 `lib.rs setup`(app handle 已可用、store 插件已注册)调用。

### D6. 单测策略调整(对照 spec R8 清单)⚠️ 偏离 spec 需记录
spec A1/A2 原写"`enable()` 后 guard 存在 / 幂等"为 Rust 单测,但 guard 是 keepawake native 行为,且本项目 Win `cargo test` 有 `0xc0000139` 通病(见 npm-registry changelog)。→ 调整:guard 实际行为归入 **C 类真机 QA**(本来就是 native);Rust 单测改测**纯逻辑** `enabled_from_store_value`(持久化值解析)5 个 case:stored true/false、never-stored 默认 false、缺字段 default、类型损坏防御回退。仍满足 R5 Medium ≥3 unit,且不碰 native 可独立 rustc 跑。

### D7. 归属飞书设置栏目(fork-only)
开关挂 `settings-feishu.tsx`(已是 FORK 文件)而非通用设置组 → 前端零上游侵入。语义:当前唯一远程常驻场景就是飞书。技术上是全局行为,将来出现别的远程场景再提升,现不超前设计。

## fork 侵入清单
- 新文件:`prevent_sleep.rs`(fork-only)
- `lib.rs`:mod 1 行 + command 注册 2 行 + 启动恢复 5 行(唯一上游文件,FORK marker)
- `system_tray.rs`:fork 模块内增订(import/常量/句柄/菜单项/事件/同步函数)
- `settings-feishu.tsx`:fork 文件内增订
- `Cargo.toml`:加 keepawake(R2 例外免 marker,仍加注释)
- i18n × 3:各 +2 key
- 托盘菜单文案沿用硬编码中文(现状,不做 Rust i18n)

## 验证记录
- [x] 前端 typecheck:17/17 全过(2026-06-06)
- [x] Rust cargo check:Finished 0 error;我的新代码 0 warning(7 warning 全 pre-existing)
- [x] Rust 单测:test profile 编译 0 error,但运行撞 Win `0xc0000139`(tauri lib 测试 exe DLL 通病,非逻辑问题)→ 抽 `enabled_from_store_value` 纯逻辑到独立临时 crate `cargo test` **5 passed**(2026-06-06)
- [x] cargo build --release:Finished release profile 0 error(keepawake release 编译验证)
- [x] release build DeskFox.exe:`Built application at ...target\release\DeskFox.exe`(2026-06-06,含 media-gen 插件打包 + tauri release)
- [x] 前端 e2e(B1/B2):Phase 1 mock 加 set/get stub + spec 2 case **passed**;全套回归 16 passed+3 skip 无回归(2026-06-06)。B3 event 同步因 mock 不 alias event 改为 .catch 降级 + 验无 error
- [ ] 真机 QA(C1-C7):由 user 在真机验(CDP 测不了"系统真没睡")

> build 踩坑:首次 build 我外层加了 `2>&1`,在 PS5.1 下把 media-gen 子脚本里 bun 的正常 stderr 输出包成 ErrorRecord,撞 `$ErrorActionPreference="Stop"` 假失败。去掉 `2>&1`(stderr 工具已自动捕获)即过。对照 CLAUDE.md PowerShell native stderr 警示。
