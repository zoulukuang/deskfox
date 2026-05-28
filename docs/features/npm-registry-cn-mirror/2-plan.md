---
feat-id: npm-registry-cn-mirror
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 2-plan — 实施计划 + 决策轨迹

## 实施步骤

1. 新建 `packages/desktop/src-tauri/src/npm_registry.rs`:镜像清单常量 + 缓存读写 + 即时猜测 + 探活 + 纯决策逻辑 + `decide(app)` 入口 + 单测。
2. `lib.rs` 加 `mod npm_registry;`(FORK marker)。
3. `cli.rs` `spawn_command` 的 `envs` 构造处注入 `npm_config_registry`(FORK marker,≤5 行,放在 extra_env extend 之前以便显式 override 可覆盖)。
4. 验证:cargo check + 纯逻辑单测(独立 rustc 跑)+ release 品牌 build。

## 决策轨迹

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 治本方式:打包预置包 vs 写镜像 | **镜像**。实测 `@opencode-ai/plugin` 全依赖树 56MB(effect 撑大,且 sidecar 已内置 effect = 重复);60KB 精简预置是非功能空壳(缺 effect,手写插件 import 仍崩)。镜像零增量、让安装秒成后缓存,且顺带加速用户自装插件。 |
| 2 | `.npmrc` 文件 vs 环境变量注入 | **环境变量**。`.npmrc` 写配置目录只覆盖后台装包那条路径(`Npm.add` 用 `global.cache/packages/<pkg>` 别的 dir,读不到);写 `~/.npmrc` 又污染用户全局 npm。`npm-config.ts:18` 带 `env:{...process.env}` → 注入 `npm_config_registry` 进程级一次覆盖两条路径,且 scoped 到 sidecar 进程、可逆、国际用户不设即默认。 |
| 3 | 区域区分:locale vs 时区 vs 探活 | **时区即时猜 + 后台探活权威**。纯 locale 需平台特定代码 / 新依赖;纯探活会给启动加网络成本。时区(chrono 已是依赖,UTC+8)零成本即时猜;后台探活(测官方快不快 + 选最快镜像)才是权威,自动区分国内/国际并自愈,首启不阻塞。 |
| 4 | 探活请求体量 | GET 包元数据但**不读 body**(send() 拿 headers 即测得首字节延迟,response drop 关连接,不下 15MB);Range 头兜底防缓冲。 |
| 5 | 后台探活 runtime | 自带 `current_thread` tokio runtime 的 `std::thread`,不假设 spawn 时处在 tokio 上下文,robust。 |
| 6 | "下载完全后台化、不阻塞首次交互" 是否一并做 | **不做,留 backlog**。它要改上游 `plugin/index.ts:167` 的核心插件加载流程(先加载失败再延迟补),风险高;且 B 让安装秒成+永久缓存后,"慢慢下"的场景已消失,边际收益小。先上 B 观察。 |

## 架构事实(实施前 grep/读源码确认)

- `serve.ts:19` `Server.listen()` 立即监听,`/global/health` 是全局路由不碰插件 → **开窗本就不等下载**;"卡"在首次项目交互触发的 `waitForDependencies`。
- `cli.rs:385-391` 已有同款 FORK env 注入先例(`OPENCODE_DISABLE_AUTOUPDATE`),照抄模式。
- 注入加到 `envs`(平台分支之前)→ Windows 非 WSL / WSL / unix 三分支都吃到。

## 测试计划

- 纯决策逻辑(`pick_registry` / `is_fresh`)+ Decision serde:Rust `#[cfg(test)]` 单测(6 个)。
- **已知约束**:本 src-tauri crate 在 Windows 下 `cargo test` 启动测试 exe 必报 `0xc0000139 STATUS_ENTRYPOINT_NOT_FOUND`(链接打补丁 tauri/WebView2 找不到导出符号)——**crate 通病**(已验证 `linux` 等现有模块测试同样无法启动),非本 feat 引入。故核心纯逻辑用独立 `rustc --test` 跑通验证(绕开 tauri 链接);编译正确性靠 `cargo check`。
