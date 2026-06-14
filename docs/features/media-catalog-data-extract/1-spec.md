feat-id: media-catalog-data-extract
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# media-gen 模型目录 数据/代码分层(阶段 1)

## 背景

媒体模型适配「数据/代码分层 + 开源 registry」三阶段路线的**阶段 1**。
决策底稿:[`OPENCODE-PLAN/需求池/媒体模型适配-数据代码分层与开源registry.md`](../../../../OPENCODE-PLAN/需求池/媒体模型适配-数据代码分层与开源registry.md)。

起源:MiMo Omni 模型 2026-06-30 下线 → 模型上下线会逼着改代码重发版。把「哪个供应商/套餐/模型/能力/参数」这类**会频繁变动的数据**从代码里剥离,为后续(阶段 2 打包时拉线上快照 / 阶段 3 运行时在线拉)打基础。

## 范围(只做阶段 1)

- 把 `packages/media-gen/src/catalog.ts` 里 `BUILTIN_CATALOG` 的**数据本体**抽到同目录纯数据文件 `catalog.data.json`。
- 配一份可移植 `catalog.schema.json`(JSON Schema draft-07),作为开源 registry 的契约产物。
- 类型(`Capability` / `CatalogEntry`)、`CAPABILITY_LABEL`、`*_KEY` 常量等**代码**留在 `catalog.ts`。
- **运行时读法不变**:Bun.build 把 JSON 内联进单文件 `dist/plugin.js`,`catalog.ts` import 后原样导出 `BUILTIN_CATALOG`。
- **不在运行时做 schema 校验**(与抽取前行为一致,零新增风险);校验只在测试/打包期跑。

## 不做(留后续阶段)

- 不开源仓、不联网(阶段 2)。
- 不改运行时在线拉(阶段 3)。
- 不抽 MediaAdapter、不动 dispatch/adapter/auth 任何逻辑。

## 验收标准

1. `bun run typecheck` 通过。
2. `bun test`(media-gen)全过,新增数据层测试覆盖:结构必填/类型、id 唯一、capability 枚举与代码一致、providerKey 已知集合、每 capability ≤1 default、无未知字段、schema↔代码防漂移。
3. 重建 `dist/plugin.js` 后,JSON 数据被内联进单文件包(无运行时外部读取)。
4. 对外 API 一字不变:`BUILTIN_CATALOG` / `CatalogEntry` / `Capability` / `CAPABILITY_LABEL` / `ALIBABA_KEY` / `MINIMAX_KEY` / `XIAOMI_KEY` 导出不变,dispatch.ts / registry.ts 零改动。
