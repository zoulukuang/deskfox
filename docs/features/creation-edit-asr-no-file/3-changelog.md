---
feat-id: creation-edit-asr-no-file
status: done
related: ./3-changelog.md
---

# 3-changelog — 创作模式 `@<路径>` 文件引用没传给图编辑/ASR

## 现象(user 报)

创作模式下,用户在输入框里用 `@creations/images/x.png` 引文件再选「图片编辑」,系统回:**「图片编辑需要先提供一张图片。」**。同样 `@creations/audio/x.wav` + 「语音识别」回:**「转写需要先提供一个音频文件。」**。
但纯文本输入的 TTS / 文生图 正常。

## 根因

`packages/app/src/components/prompt-input.tsx` 的 `submitCreation`(创作模式提交)**只识别 base64 附件**(`+号` 加入的 `type:"image"` part with `dataUrl`),**完全忽略 `type:"file"` part**(`@<path>` 文件引用)。具体两个缺口:

| capability | 原行为 | 后果 |
|---|---|---|
| `image_edit` / `video_i2v` | `refFile` 只认 `imagePart.dataUrl`(`+号` 附件 base64) | `@<path>` 引图必失败 |
| `asr` | `input.audioUrl` 整段代码**从未赋值过**(无任何附件通道) | ASR 拿不到音频,必失败 |

附带:`@`-popover 给的 `option.path` 是项目相对路径(如 `creations/images/x.png`),sidecar 端 `readFileSync` 用进程 cwd 解析,大概率读不到——需拼绝对。

## 修法

helper extract 模式(进 R5 v3.1 双清单的 Logic 清单),纯函数 + 18 单测:

新建 `packages/app/src/components/prompt-input/creation-input.ts`(~73 行):
- `absolutePath(dir, p)` —— 复用 `build-request-parts.ts:33-38` 同款规则(Win 盘符 / UNC / POSIX 兼容,对已绝对 idempotent)。
- `buildCreationInput({ parts, capability, projectDir, voice?, targetLang? })` —— 纯函数:
  1. **prompt 只取 `text` part**(`file`/`agent` 的 `@<x>` 字面不进 prompt,避免污染厂商 API 指令)
  2. 第一个 `file` part 的 `path` 经 `absolutePath` 拼绝对,按 capability 路由:
     - `image_edit` / `video_i2v` → `refFile`
     - `asr` → `audioUrl`
     - 其他 capability → 忽略(它们不需文件)
  3. 兼容旧附件通道:`image_edit`/`video_i2v` 没 file part 时回落到 base64 dataUrl
  4. 多个 file part → 取第一个(MVP)

`prompt-input.tsx submitCreation` 把原 4-line 装配块替换为单行 `buildCreationInput({...})` 调用(净 -3 行代码 + 2 行 FORK marker 注释)。

## 改动文件 / 行数

| 文件 | 改动 | 行数 |
|---|---|---|
| `packages/app/src/components/prompt-input/creation-input.ts` | **新建** helper + 类型 | +73 |
| `packages/app/src/components/prompt-input/creation-input.test.ts` | **新建** 18 单测(absolutePath 4 + bug-repro 5 + 兼容/边界 9) | +122 |
| `packages/app/src/components/prompt-input.tsx` | import + `submitCreation` 接入 helper | 净 +5(+11 -6) |

总 **3 文件 / 净 +200 行**(其中 122 是测试,纯产品代码 ~80 行)。

## 测试 / 验证

- **bug-repro 单测**(R5 v3 要求):`creation-input.test.ts` **18 pass / 0 fail / 199ms**
  - `absolutePath`:4 个(相对拼绝对 / Win 绝对 idempotent / POSIX idempotent / UNC / 末尾斜杠去重)
  - **bug-repro 主战场**:5 个(image_edit @<path>、asr @<path>、video_i2v @<path>、image_edit 没文件、asr 没文件)
  - **向后兼容 + 边界**:9 个(base64 附件仍工作 / file part 优先于 base64 / 多 file 取第一 / image 文生图忽略 file / tts voice / translate targetLang / agent 字面剥离 / 绝对路径不双拼)
- **app 全套回归**:**729 pass / 0 fail / 6.65s**(原 711 + 新增 18,**零回归**)
- **typecheck**:`@opencode-ai/app` 通过

## 真机验证(待 user)

新 dev 包装上去后,用户在输入框 `@creations/images/x.png 加个红色斗篷` + 选「图片编辑」应正常生成,不再报「需要先提供一张图片」。ASR 同款。

## commit

- (本笔 commit,grep `[feat: creation-edit-asr-no-file]` 反查) fix(app): 创作模式 @<路径> 文件引用接入 refFile/audioUrl(图编辑/ASR/图生视频)

## 影响范围 / 健康指标

- 上游侵入:**0 改上游 TS**(`prompt-input.tsx` 已是 fork 改动集内 FORK marker 文件;新 helper 是 fork-only 新文件)。
- override:0(无 R4 黑名单)。
- 测试纪律:符合 R5 v3.1(bug-repro 测试先行,fix + 测试同一 commit,`[bug-repro: ...]` tag)。

## 回退

`git revert` 本 commit;helper 删除回到原 4-line 装配。P4 可逆。
