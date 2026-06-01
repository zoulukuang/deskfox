feat-id: media-catalog-data-extract
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实际改动 changelog

## 规模

Medium(单一主题:数据/代码分层抽取;无行为变化的重构 + 测试)。纯 fork-only,0 改上游,0 R4 override。

## 改动文件

| 文件 | 性质 | 说明 |
|---|---|---|
| `packages/media-gen/src/catalog.data.json` | 新增 | 15 条 catalog entry 纯数据(阿里 8 + MiniMax 3 + 小米 MiMo 4)。原内联踩坑/决策注释落到可选 `note` 字段。 |
| `packages/media-gen/src/catalog.schema.json` | 新增 | JSON Schema draft-07,catalog.data.json 的可移植契约;阶段 2 开源 registry 复用做 PR 校验。 |
| `packages/media-gen/src/catalog.ts` | 改 | -164 +22 行。删内联 `BUILTIN_CATALOG` 数组 → import JSON 重导出;`CatalogEntry` 加可选 `note`;移除无引用的供应商显示名常量;FORK-BEGIN/END 标记。类型/`CAPABILITY_LABEL`/`*_KEY` 导出不变。 |
| `packages/media-gen/__tests__/catalog-data.test.ts` | 新增 | 数据层 Logic 测试,12 用例(结构/唯一/枚举一致/providerKey/默认唯一/无未知字段/参数类型 + 3 条 schema↔代码防漂移)。 |

## 影响范围

- **运行时**:零行为变化。`BUILTIN_CATALOG` 由静态数组改为「import 内联 JSON 后原样导出」,值完全一致。
- **下游消费方**:`dispatch.ts` / `registry.ts` 零改动(导出 API 不变)。
- **打包**:`dist/plugin.js` 由 Bun.build 把 JSON 内联,单文件包体含全部数据,无运行时外部读取。`packages/branding/plugin/media-gen/dist` 在 pack-installer 时重建,自动带新数据。

## 回归测试

- `bun run typecheck`(全仓 turbo 全量):**17/17 successful**(下游类型不破)。
- `bun test`(media-gen 全包):**140 pass / 0 fail**(原 128 + 新 12)。
- `bun run build` 重建 `dist/plugin.js`:成功,验证标志值(`wanx2.1-t2i-turbo` / `mimo-v2.5-tts-voiceclone` / `MiniMax-Hailuo-2.3`)均内联,无 `require/import/readFileSync` 外部 json。

## 运行时验证(CDP 自测,2026-06-01)

按「CDP 自测 ≠ 真桌面 QA」原则补运行时 smoke,验证内联 JSON 的 catalog 在**真实边车**里加载正常(这是本改动唯一真风险:数据从 TS 数组改内联 JSON 后,sidecar 运行时行为是否一致)。

- 流程:`build-deskfox.ps1 -Env dev -NoBundle` 出新 exe(media-gen 插件 staged 进 branding,grep 确认含新数据)→ 启动开 `--remote-debugging-port=9222` → `scripts/cdp-catalog-verify.ts` 遍历创作模式 9 档能力,逐档展开模型下拉收集 model id,与 catalog.data.json 比对。
- 本机三家供应商全连(alibaba-cn / minimax-cn-coding-plan / xiaomi-token-plan-cn)。
- **结果 PASS**:9 个创作能力档全在;15 个 model id 0 缺失;语音合成档三家齐(`qwen-tts` + `speech-2.8-hd` + `mimo-v2.5-tts`),语音识别档 `paraformer-v2` + `mimo-v2.5`(Omni)。
- 新增验证脚本:`packages/media-gen/scripts/cdp-catalog-verify.ts`(可供阶段 2/3 重跑)。
- 注:前端创作模式能力标签是独立副本(UI 显示「语音合成/语音识别」),与 catalog.ts `CAPABILITY_LABEL`(「配音/转写」)不同名 —— 本改动不涉及,记录备忘。

## commit

(commit hash 提交后补)— `refactor(media-gen): catalog 数据/代码分层 — 抽 catalog.data.json + schema [feat: media-catalog-data-extract]`

## 回退方法

`git revert <commit>` 即可;或还原 `catalog.ts` 内联数组、删 3 个新文件。无运行时状态/迁移,纯可逆。

## 后续

- 阶段 2:开源仓(JSON + schema + 校验 CI)+ 打包时拉最新快照。
- 阶段 3(可选):运行时在线拉 + 内置兜底 + 运行时 schema 校验。
- 决策路线见 `OPENCODE-PLAN/需求池/媒体模型适配-数据代码分层与开源registry.md`。
