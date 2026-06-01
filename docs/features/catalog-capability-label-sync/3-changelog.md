feat-id: catalog-capability-label-sync
status: done
related: ./3-changelog.md

# catalog.ts CAPABILITY_LABEL 对齐真 UI 标签(Tiny)

## 背景

`media-catalog-data-extract`(阶段 1)CDP 运行时验证时发现:`packages/media-gen/src/catalog.ts` 的 `CAPABILITY_LABEL` 把 tts 标成「配音」、asr 标成「转写」,而用户真正看到的创作模式标签是「语音合成」「语音识别」。

排查确认:
- 用户可见标签真相源 = 前端 `packages/app/src/components/media-creation-store.ts` 的 `CREATION_MODES`(语音合成 / 语音识别)。
- 插件工具描述 `packages/media-gen/src/index.ts:165/187` 也早已用「语音合成 / TTS」「语音识别 / ASR」。
- **`catalog.ts` 的 `CAPABILITY_LABEL` 是全仓唯一掉队的旧词**,且无生产代码引用(仅测试 + CDP 脚本)。

## 改动

| 文件 | 改动 |
|---|---|
| `packages/media-gen/src/catalog.ts` | `CAPABILITY_LABEL`:tts「配音」→「语音合成」、asr「转写」→「语音识别」(其余 7 个本就一致);加注释标明真相源在前端 CREATION_MODES、此处为插件侧副本须同步。 |
| `packages/media-gen/__tests__/catalog-xiaomi.test.ts` | 对应断言更新为 tts=语音合成 / asr=语音识别。 |
| `packages/media-gen/scripts/cdp-catalog-verify.ts` | 注释更新(标签已对齐,不再「可不同」)。 |

## 影响 & 验证

- 纯标签一致性修正,**无运行时行为变化**(CAPABILITY_LABEL 不驱动 UI,UI 走 CREATION_MODES)。
- typecheck pass / media-gen `bun test` 140 pass。
- 纯 fork:0 改上游 / 0 R4。

## 说明:为什么不直接消除跨包重复

capability 的 TYPE(`Capability` / `MediaCapability`)与 LABEL 在插件(sidecar)与 app(前端)两个 package 各有一份,以「同改」注释维系(`media-creation.ts:14` 已有此约定)。跨包共享需引入耦合,收益小于成本,本次只做"对齐 + 文档化真相源",不动架构。如需彻底单一真相源,另立专项评估。

## 回退

`git revert <commit>`;或把两个 label 值改回。纯可逆。
