---
feat-id: npm-registry-cn-mirror
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 3-changelog — 实际改动

## 概述

国内用户 sidecar 装 npm 插件(后台 `@opencode-ai/plugin` + 用户自装/自写插件)从默认 `registry.npmjs.org`(实测北京 12s)切到国内镜像(0.7~1.8s),终结"反复失败 + 每次启动空等"。国际用户保持官方。纯 fork 注入,0 改上游 TS。

## commit

- (本笔 commit,grep `[feat: npm-registry-cn-mirror]` 反查) feat(desktop): 国内用户 sidecar npm 走国内镜像 + 探活自愈

## 改动文件

| 文件 | 改动 | 行数 |
|---|---|---|
| `packages/desktop/src-tauri/src/npm_registry.rs` | **新建** fork-only 模块:镜像清单 / 缓存读写 / 时区即时猜 / 探活 / 纯决策逻辑 / `decide(app)` / 6 单测 | +~210 |
| `packages/desktop/src-tauri/src/lib.rs` | 加 `mod npm_registry;`(FORK marker) | +2 |
| `packages/desktop/src-tauri/src/cli.rs` | `spawn_command` 注入 `npm_config_registry`(FORK marker,含可观测日志) | +5 |
| `docs/features/npm-registry-cn-mirror/{1-spec,2-plan,3-changelog}.md` | 三文档 | 新建 |

**0 改上游 TS**(`npm.ts` / `config.ts` / `npm-config.ts` 一行未动)。上游侵入仅 `cli.rs` / `lib.rs` 两个已带 FORK marker 的桌面入口文件,各 ≤5 行注入。

## 关键实现

- **注入点**:`cli.rs spawn_command` 的 `envs`,`npm-config.ts:18` 带 `env:{...process.env}` → 一次注入覆盖"后台装包 + 用户装插件"两条路径,scoped 到 sidecar 进程,国际用户不注入即默认官方,完全可逆。
- **区域区分**:首启时区 UTC+8 即时猜主镜像(零网络不阻塞);后台线程探活(官方 ≤2.5s → 判国际用官方;否则并发探镜像取最快可用;全挂回落官方),写 14 天 TTL 缓存,下次直接用,镜像挂/跨境自愈。
- **探活轻量**:GET 包元数据不读 body(只测首字节延迟,不下 15MB)+ Range 头兜底。
- **镜像清单**(2026-05-28 实测能取 `@opencode-ai/plugin`):npmmirror(主)/ huaweicloud / tencent / huaweicloud-repo / cnpmjs。清华 tuna、中科大 ustc 实测 404 已淘汰。

## 测试 / 验证

- **单测**(R5 Medium ≥3):6 个 `#[cfg(test)]`(pick_registry 4 + is_fresh 1 + Decision serde 1),覆盖纯决策逻辑。
- **cargo check**:exit 0,模块零 error(余警告均 system_tray/logging 既有)。
- **纯逻辑实跑**:独立 `rustc --test` 跑通 5 个决策/freshness 断言(绕开 crate 通病,见下)。
- **release build**:`build-deskfox.ps1 -Env dev -NoBundle` 出 `DeskFox.exe`(1m22s),品牌打包流程未破坏。
- **运行时冒烟**:启动 DeskFox(本机 UTC+8),dev 日志确认注入触发 —
  `INFO opencode_lib::cli: [npm-registry] sidecar 走 npm 镜像: https://registry.npmmirror.com`

## 已知约束

- src-tauri crate 在 Windows `cargo test` 启动测试 exe 必报 `0xc0000139 STATUS_ENTRYPOINT_NOT_FOUND`(链接打补丁 tauri/WebView2 缺导出符号)——**crate 通病**(已验证 `linux` 等现有模块测试同样无法启动),非本 feat 引入。核心纯逻辑改用独立 `rustc --test` 验证。

## 回归 / 回退

- 回归面极小:仅给 sidecar 进程多注入一个环境变量;国际用户(非 UTC+8 且官方快)行为完全不变。
- 回退:`git revert` 本 commit 即可(P4 可逆,一笔 commit 干一件事)。

## 影响范围 / 健康指标

- 上游侵入:0 新增改上游文件(`cli.rs`/`lib.rs` 本就在 fork 改动集内);新增 1 个 fork-only 文件(稀释侵入率)。
- override:0(无黑名单 R4)。

## Follow-up(留 backlog,不在本 feat)

- 插件加载完全异步化(`plugin/index.ts:167` waitForDependencies 不阻塞首次交互)——改上游核心流程高风险,且 B 后边际收益小,观察后再定。
