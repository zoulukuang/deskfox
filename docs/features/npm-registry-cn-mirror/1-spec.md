---
feat-id: npm-registry-cn-mirror
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 1-spec — 国内用户 sidecar npm 走国内镜像

## 背景 / 问题

sidecar(opencode-cli)启动时,`config.ts:558` 会在配置目录后台装 `@opencode-ai/plugin`(给写插件的人用的类型包),默认走 `registry.npmjs.org`。用户装/写插件(`Npm.add`)同样默认走官方源。

实测(2026-05-28,北京网络):官方 `registry.npmjs.org` 取 `@opencode-ai/plugin` 元数据 **12.0s**,国内镜像 **0.7~1.8s**。

国内用户连不上 / 连得慢 npmjs 时:
- 该后台装包**反复失败**(`node_modules/@opencode-ai/plugin` 建不起来 → 每次启动重试);
- 启动时 `Plugin.state` 里 `waitForDependencies()`(`plugin/index.ts:167`,首次项目交互触发)会**空等它超时返回**才继续 → 表现为"每次开都卡一下"。

> 注:这是"慢"不是"坏"——失败也优雅降级,功能(飞书/media-gen 等内置插件 file:// 加载、不依赖此包)不受影响。详见研究结论(本 spec 末)。

## 目标

让**国内用户**的 sidecar 用国内 npm 镜像,把"反复失败/空等"变成"一次秒装、永久缓存";**国际用户**保持官方源不变。要求健壮:镜像清单经验证、可自愈(某镜像挂了自动换)。

## 非目标

- **不**改上游 `npm.ts` / `config.ts` / `npm-config.ts`(纯 fork 注入实现)。
- **不**做"插件加载完全异步化 / 下载彻底后台不阻塞首次交互"(评估后认定:B 让安装秒成+缓存后该问题已基本消失,异步化是改上游核心流程的独立高风险项,留 backlog 观察后再定)。
- **不**预置打包 `@opencode-ai/plugin` 进安装包(56MB 全树 / effect 与 sidecar 重复;60KB 精简版是非功能空壳,反而坑手写插件)——故选镜像方案而非打包方案。

## 方案(B:镜像 + 区域区分 + 探活自愈)

**注入机制**:`npm-config.ts:18` 加载 npm 配置时带 `env: { ...process.env }`,故只需给 sidecar 进程注入环境变量 `npm_config_registry=<镜像>`,**后台装 plugin + 用户装插件两条路径同时生效**,零文件污染、完全可逆、国际用户不注入即保持官方。

**区域区分 + 健壮性**:
1. **首启即时猜测(零网络,不阻塞)**:本机时区 UTC+8 视为国内 → 先用主镜像 `registry.npmmirror.com`;否则用官方。
2. **后台探活选最优 + 自愈**:启动后台(不阻塞)探活——官方本身就快(≤2.5s)→ 判定国际用户用官方;否则并发探镜像清单取**最快可用**;全挂 → 回落官方。结果写缓存(14 天 TTL),下次启动直接用;镜像挂了 / 用户跨境下次探活自动纠正。

**验证过的镜像清单(2026-05-28 实测能取到 `@opencode-ai/plugin`,按可靠性排序)**:
1. `registry.npmmirror.com`(阿里,主用)
2. `mirrors.huaweicloud.com/repository/npm`(华为云)
3. `mirrors.cloud.tencent.com/npm`(腾讯云)
4. `repo.huaweicloud.com/repository/npm`(华为云备用)
5. `r.cnpmjs.org`(cnpm)

> 清华 tuna / 中科大 ustc 实测 404(不提供 registry API),已淘汰。

## 验收标准

- [x] 国内(UTC+8)首启即注入主镜像,sidecar 装 `@opencode-ai/plugin` 走镜像。
- [x] 国际用户不注入 `npm_config_registry`,保持官方 npmjs。
- [x] 镜像清单经实测验证;后台探活取最快可用、全挂回落官方。
- [x] 缓存自愈(14 天 TTL 重探)。
- [x] 纯 fork 加法:0 改上游 TS;仅碰 `cli.rs` spawn 1 处(≤5 行 + FORK marker)+ 1 个新 Rust 模块。
- [x] 核心决策逻辑单测覆盖(R5 Medium ≥3 unit)。

## 改动规模

Medium(新 Rust 模块 ~180 行 + `cli.rs` ≤5 行注入 + `lib.rs` 1 行 mod + 三文档)。
