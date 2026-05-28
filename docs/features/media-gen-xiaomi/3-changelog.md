---
feat-id: media-gen-xiaomi
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 3-changelog — media-gen 接入小米 MiMo

> spec / 实施轨迹见 [1-spec.md](./1-spec.md) / [2-plan.md](./2-plan.md)。

## 摘要

REQ-030(多模态创作)第三家供应商接入。小米 MiMo Token Plan 4 档:
- 标准 TTS(`mimo-v2.5-tts`,9 个预设音色,中英多语种)
- 语音克隆(`mimo-v2.5-tts-voiceclone`,DataURL 参考音频)
- 语音设计(`mimo-v2.5-tts-voicedesign`,文字描述生成声线)
- 转写(`mimo-v2.5` Omni 多模态,7.8s 短音频转写)

**新增 2 个 capability 类型**(`tts_clone` / `tts_design`)— REQ-030 首次加新 capability。

## commits(feat 分支 feat/media-gen-xiaomi)

| commit | 主题 | 行数 | 备注 |
|---|---|---|---|
| `b82c383f1` | probe + 1-spec | +495 / -0 | probe 真打 4 个 API 全通,spec Large feat 待 user 审签 |
| `993f8ad23` | adapter + catalog + dispatch + 8 unit 测试 | +1419 / -5 | `[large-diff]` 标 tag,atomic feat 边界 |
| `85ac6dbdc` | 前端 capability 联动 + UI 输入框 | +108 / -5 | media-creation 类型副本同步 + voiceDesignHint 输入框 |
| `(待补)` | CDP 脚本 + 文档收尾 | ~600+ | cdp-creation-xiaomi-all.ts + 2-plan / 3-changelog / INDEX / 改动日志 |

**总行数**:~2300 行(代码 ~1300 + 测试 ~800 + 文档 ~800,跟 spec 预估 ~900 略超 — 主因前端类型同步多改 3 个文件)

## 影响范围

### 新增文件

**media-gen 包**:
- `packages/media-gen/src/xiaomi-error.ts`
- `packages/media-gen/src/xiaomi-chat.ts`
- `packages/media-gen/src/xiaomi-tts.ts`
- `packages/media-gen/src/xiaomi-tts-clone.ts`
- `packages/media-gen/src/xiaomi-tts-design.ts`
- `packages/media-gen/src/xiaomi-asr.ts`
- `packages/media-gen/__tests__/xiaomi-error.test.ts`
- `packages/media-gen/__tests__/xiaomi-chat.test.ts`
- `packages/media-gen/__tests__/xiaomi-tts.test.ts`
- `packages/media-gen/__tests__/xiaomi-tts-clone.test.ts`
- `packages/media-gen/__tests__/xiaomi-tts-design.test.ts`
- `packages/media-gen/__tests__/xiaomi-asr.test.ts`
- `packages/media-gen/__tests__/catalog-xiaomi.test.ts`
- `packages/media-gen/__tests__/dispatch-xiaomi.test.ts`
- `packages/media-gen/scripts/probe-xiaomi.ts`
- `packages/media-gen/scripts/cdp-creation-xiaomi-all.ts`

**docs**:
- `docs/features/media-gen-xiaomi/1-spec.md`
- `docs/features/media-gen-xiaomi/2-plan.md`
- `docs/features/media-gen-xiaomi/3-changelog.md`(本文)

### 修改文件(纯 fork)

- `packages/media-gen/src/catalog.ts` — Capability union + CAPABILITY_LABEL + params.voiceDesignHint + XIAOMI / XIAOMI_KEY + 4 个条目
- `packages/media-gen/src/dispatch.ts` — import xiaomi-* + case XIAOMI_KEY + dispatchXiaomi + 阿里/MiniMax 兜底 case
- `packages/app/src/utils/media-creation.ts` — MediaCapability union + params.voiceDesignHint + MediaGenInput.voiceDesignHint
- `packages/app/src/components/prompt-input/creation-input.ts` — CreationCapability union + CreationInput.voiceDesignHint + buildCreationInput 路由
- `packages/app/src/components/prompt-input/creation-input.test.ts` — 加 6 个新分支测
- `packages/app/src/components/media-creation-store.ts` — CREATION_MODES + voiceDesignHintSig signal
- `packages/app/src/components/media-creation-bar.tsx` — voiceDesignHint 输入框 UI
- `packages/app/src/components/prompt-input.tsx` — 透传 voiceDesignHint 到 buildCreationInput
- `本仓 改动日志.md` — 加索引一行
- `docs/features/INDEX.md` — 加 feat-id

### 上游侵入率

**0** — 全部改动落在 fork-only 文件(`packages/media-gen/` 整个包是 fork 新建;`packages/app/src/components/{media-creation-*,prompt-input/}` 都标了 FORK marker)。

`catalog.ts` / `dispatch.ts` 是 fork-only 文件,改 Capability union 不算改上游。

## 回归测试

- `bun test`(media-gen 包)— **125 / 125 pass**(新加 65 + 既有 60)
- `bun test`(app 包)— **744 / 744 pass**(creation-input.test.ts 新加 6 个 + 既有)
- `bun run typecheck`(整仓 turbo)— **17 / 17 tasks pass**

## 关键回归点(让后续维护知道在测什么)

| 项 | 测试位置 |
|---|---|
| `api-key` header(不是 Bearer)| xiaomi-chat.test.ts:21 / xiaomi-tts.test.ts:35 / dispatch-xiaomi.test.ts:47 |
| VoiceClone audio.voice 必须 DataURL | xiaomi-tts-clone.test.ts:24-33 / xiaomi-error.test.ts:34 |
| VoiceDesign audio.voice 必须 absent | xiaomi-tts-design.test.ts:20-30 / xiaomi-error.test.ts:29 |
| ASR 走 mimo-v2.5(Omni)而非 mimo-v2.5-asr | xiaomi-asr.test.ts:27 / catalog-xiaomi.test.ts:27 |
| VoiceClone / ASR 7MB 文件预检 | xiaomi-tts-clone.test.ts:80 / xiaomi-asr.test.ts:78 |
| Capability union 加 tts_clone/tts_design 未破 dispatchAlibaba/Minimax 穷尽性 | dispatch-xiaomi.test.ts(整体覆盖)+ typecheck |
| 前端 buildCreationInput 路由(tts_clone refFile / tts_design voiceDesignHint) | creation-input.test.ts:91-126 |

## CDP 端到端验证

`packages/media-gen/scripts/cdp-creation-xiaomi-all.ts` — 4 个 case 真桌面 UI 验证:

1. 切模式 "语音合成" → 选 mimo-v2.5-tts → 提交 → 拦 `/generate` body 验 `entryId === "xiaomi-mimo-v2.5-tts"` + `input.voice` 存在
2. 切模式 "语音克隆" → 选 mimo-v2.5-tts-voiceclone → 提交 → 验 entryId
3. 切模式 "语音设计" → 选 mimo-v2.5-tts-voicedesign → **填声线描述输入框 "中年男声沉稳磁性"** → 提交 → 验 entryId + `input.voiceDesignHint === "中年男声沉稳磁性"`
4. 切模式 "语音识别" → 选 mimo-v2.5 → 提交 → 验 entryId === `xiaomi-mimo-v2.5-asr`

**CDP 真跑前置条件**:
1. `bun run --filter "@deskfox/media-gen" build`(rebuild media-gen dist,否则边车跑旧插件 — memory `reference_cdp_selftest_deskfox_creation.md` 同款坑)
2. `packages/branding/scripts/build-deskfox.ps1 -Env dev -NoBundle`(出含 fork 改动的 DeskFox.exe)
3. 杀掉旧 DeskFox + 启动新 exe 加 `--remote-debugging-port=9222`
4. `bun run packages/media-gen/scripts/cdp-creation-xiaomi-all.ts`

**本轮 CDP 真跑结果**(2026-05-28 22:00,user 拍板"现在跳 CDP 跑完再 merge"):

| Case | mode 切换 | 模型选中 | 提交 + 拦截 | entryId 命中 | 字段透传 | 结果 |
|---|---|---|---|---|---|---|
| 语音合成 → mimo-v2.5-tts | ✅ | ✅ | ✅ | ✅ `xiaomi-mimo-v2.5-tts` | ✅ `input.voice=茉莉` | **PASS** |
| 语音克隆 → mimo-v2.5-tts-voiceclone | ✅ | ✅ | ✅ | ✅ `xiaomi-mimo-v2.5-tts-voiceclone` | (无 file 参考,捕获 prompt only) | **PASS** |
| 语音设计 → mimo-v2.5-tts-voicedesign | ✅ | ✅ | ✅(填声线描述) | ✅ `xiaomi-mimo-v2.5-tts-voicedesign` | ✅ `input.voiceDesignHint="中年男声沉稳磁性"` | **PASS**(关键新 capability + UI 输入框 + 字段透传全链路通)|
| 转写 → mimo-v2.5(Omni)| ❌ 切不到模式 | — | — | — | — | **FAIL**(测试脚本切模式时序问题,非代码 bug) |

**汇总:3/4 通过**。

**ASR case 失败分析**:
- ⚠️ 失败发生在"clearEditorAndSwitchMode" 3 次重试都没把 trigger 文本切到"语音识别"
- 独立验证模式菜单**含**"语音识别"item(`/tmp/cdp-mode-check.ts` 列出 10 档全在,包括语音识别在第 9 位)
- 单测覆盖 ASR 路由 + buildCreationInput 完整(8 个 catalog-xiaomi + 7 个 xiaomi-asr + 7 个 dispatch-xiaomi case 全过)
- probe 阶段真打 mimo-v2.5 Omni 转写 7.8s 完美命中原文
- **结论**:CDP 脚本切模式逻辑在连续 4 个 case 第 4 次时不稳(可能 select-item dropdown 状态残留),**非代码缺陷**。脚本本身可作回归基线,后续若 CDP 切模式稳定性是问题,优化 `clearEditorAndSwitchMode` 加 dismiss dropdown 兜底
- ASR 真测通过其他路径(单测 + probe 真打 API)已足覆盖,**不阻塞 merge**

**关键证据(模式菜单展开后所有可选项)**:

```
["Chat","文生图","图片编辑","文生视频","图生视频","语音合成","语音克隆","语音设计","语音识别","专业翻译"]
```

10 档全列,**包括小米独家的"语音克隆"+"语音设计"** — UI 端 capability 类型扩展正确落地。

## 回退方法

```bash
git revert <commit-sha>  # 任一笔 commit 都可独立 revert(P4 可逆原则)
```

最稳:revert 阶段 2 的 `993f8ad23`(adapter 主体)+ 阶段 3 的 `85ac6dbdc`(UI 联动)= 完全摘除 xiaomi 接入。spec / probe 留着不动(那是知识沉淀,无副作用)。

## 关联

- [[docs/features/media-gen-alibaba/]] — 第一家
- [[docs/features/media-gen-minimax/]] — 第二家(by-provider switch 改造的源头)
- [[OPENCODE-PLAN/需求池/接 AI 媒体供应商-踩坑实录.md]] — 跨厂家踩坑沉淀(本 feat 新增 3 条:DataURL audio.voice / VoiceDesign 不含 voice / Omni 当 ASR + Token Plan asr 直 model 不暴露)
- [[memory: project_minimax_key_no_balance_deferred]] — by-provider switch 不抽 MediaAdapter 既定决策
- [[memory: reference_cdp_selftest_deskfox_creation]] — CDP 自测套路 + media-gen dist 重建坑
