---
feat-id: media-gen-alibaba
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 多模态生成 — 阿里全能力适配 — changelog

**所在分支**: `feat/media-gen-alibaba`(基于 main,未合 main / 未 push)
**触发原因**: 见 1-spec.md
**规模**: Large（新包,全新代码 + 测试 + 脚本 ~1500 行,**0 改上游**）

## 关联 commit(feat 分支 8 笔)

| hash | 类型 | 内容 |
|---|---|---|
| `5e3016d05` | feat | 文生图竖切打通 — `media_image_generate`,DashScope 异步任务 submit/poll |
| `2b546dd96` | chore | 5 能力发现脚本 `probe-models.ts`(实测确认 ID/端点/参数) |
| `0a827dd18` | chore | 专业模型发现脚本 `probe-specialized.ts`(翻译/TTS/ASR 实测) |
| `698894f99` | refactor | 抽出共享异步任务引擎 `dashscope-task.ts`,图片模块改用之 |
| `ec76bab08` | feat | 视频/翻译/语音合成/语音识别 + 5 工具入口 |
| `9d6161555` | feat | 本地文件自动上传(识别/改图/图生视频) |
| `527a06791` | feat | 拆出专用 `media_image_edit` 工具修改图路由 |
| `c0fc43a57` | feat | 改图换用 `qwen-image-edit`(效果远超 wanx) |

## 实际改动(全新文件,fork-only)

`packages/media-gen/`(0 改上游,符合 R1):

### 工具入口
- `src/index.ts` — Plugin 入口,注册 **6 工具**:`media_image_generate`(文生图)/ `media_image_edit`(改图)/ `media_video_generate`(文/图生视频)/ `media_translate` / `media_tts` / `media_asr`
- `src/tool-shim.ts` — 本地 `tool()` 替身(避免把 `effect` 打进 bundle;type-only import 类型)

### 能力模块
- `src/dashscope-task.ts` — 共享异步任务引擎:`runDashScopeTask`(submit + `X-DashScope-Async` → 轮询 `/tasks/{id}` → 终态)+ `DashScopeError` / 错误翻译表 / `normalizeSize`(星号)/ `extraHeaders`(oss:// 资源用)
- `src/dashscope-image.ts` — 文生图(纯 t2i,异步任务)
- `src/dashscope-edit.ts` — 改图(`qwen-image-edit`,同步 multimodal-generation,本地图转 base64)
- `src/dashscope-video.ts` — 文生视频 / 图生视频(异步任务,`output.video_url`)
- `src/dashscope-tts.ts` — 语音合成(`qwen-tts`,同步多模态,返回 `output.audio.url`)
- `src/dashscope-translate.ts` — 翻译(`qwen-mt`,OpenAI 兼容同步 chat + `translation_options`)
- `src/dashscope-asr.ts` — 语音识别(`paraformer`,异步任务 + 转写 JSON 二次拉取)
- `src/dashscope-upload.ts` — 本地文件 → `oss://` 临时链接(getPolicy → multipart → OSS);`resolveInputUrl` 远程透传/本地上传
- `src/auth.ts` — 从 `~/.local/share/opencode/auth.json` 读 `alibaba-cn` key

### 测试 / 脚本 / 工程
- `__tests__/dashscope-image.test.ts`(6)+ `capabilities.test.ts`(7)+ `upload.test.ts`(3)= **16 单测**
- `scripts/`：`probe.ts` / `probe-models.ts` / `probe-specialized.ts` / `probe-upload.ts` / `probe-qwen-edit.ts`(发现脚本,真 key 实打)
- `package.json` / `tsconfig.json` / `build.ts`（bun build → `dist/plugin.js` 417K）/ `.gitignore`（dist、node_modules）

## 阿里能力实测矩阵(8 模型 / 6 能力 / 3 协议)

| 能力 | 模型 | 端点 / 协议 | 实测 |
|---|---|---|---|
| 文生图 标准 | `wanx2.1-t2i-turbo` | text2image/image-synthesis（异步） | ✅ 12.6s |
| 文生图 高清 | `wanx2.1-t2i-plus` | 同上 | ✅ 15.5s |
| 改图 | `qwen-image-edit` | multimodal-generation（同步） | ✅ 背景正确替换、对象保留（亲眼验证）|
| 文生视频 | `wanx2.1-t2v-turbo` | video-generation/video-synthesis（异步） | ✅ 32.5s → mp4 |
| 图生视频 | `wanx2.1-i2v-turbo` | 同上 | ✅ 113s → mp4 |
| 翻译 | `qwen-mt-turbo` | compatible-mode chat（同步） | ✅ |
| 语音合成 | `qwen-tts` | multimodal-generation（同步,无需 WebSocket）| ✅ → wav |
| 语音识别 | `paraformer-v2` | audio/asr/transcription（异步）+ 转写 JSON | ✅ 本地文件经 OSS 上传识别成功 |

> ⚠️ 已证伪 / 未用:`wan2.6-t2i`（url error）、`wanx2.1-imageedit`（换背景无效,被 qwen-image-edit 取代）、`happyhorse-*`（REQ-030 原文凭空,未核实）。

## 行数 / 阈值

- 全新 fork-only,**0 改上游**(R1 健康:纯新增不算侵入)
- 8 笔 commit 每笔均 < 500 行过 pre-commit `diff 阈值`检查(refactor 与 feature-add 拆开,符合 P4)
- `bun.lock` 因黑名单未提交（新包 lockfile 变更,`bun install` 自动重建,不影响运行）

## 装载方式

`~/.config/opencode/opencode.jsonc` 的 `plugin` 数组加:
`"file:///D:/project/opencode-fork/packages/media-gen/dist/plugin.js"`（编译版,绕开边车认不认 .ts 的不确定性）。备份原配置 `opencode.jsonc.bak.media-gen-20260526`。

## 回归测试点(user 桌面确认)

- ✅ 文生图(标准/高清)/ 翻译 / 语音合成 / 文生视频
- ✅ 语音识别:@提及本地音频 → 自动上传 → 识别文字（修复"本地路径云端够不着"）
- ✅ 改图:@提及本地图片"替换背景成绿色" → 调 `media_image_edit` → `qwen-image-edit` 正确替换

## review 自检

- [x] 0 改上游,无 FORK marker 需求(全新文件)
- [x] 每笔 diff 在预算内（refactor/feature 拆分）
- [x] 大小写 / 网络绑定（R6:无新增 listen）检查通过
- [x] 新增依赖:仅 `@opencode-ai/plugin`(workspace) + `zod`(catalog),无第三方
- [x] 16 单测全过 + typecheck 净 + dist 冒烟 6 工具加载 OK
- [x] 真厂商端到端人眼验过(出图/出声/出视频/改图)
- [x] 0 R4(无黑名单 override)

## 已知遗留 / follow-up

- **拖拽/粘贴进输入框的图不能直接改图** — 那是 vision 附件非文件路径,工具拿不到;当前 workaround:@提及图片文件。彻底解需 plugin 读 session attachment parts。
- **OSS 链接 24h 过期** — 图片/视频隔天 404,未做本地持久化(REQ-030 §7 二期)。
- **`/media` 命令兜底未做** — AI 路由偶发不命中(弱工具模型),留抽象那刀补 100% 可靠入口。
- **下一步**:接 minimax(第二家),从两份代码抽通用层验证框架真通用(REQ-030 §0.1 第 1 条 + §10 第 2 周验收点)。

## 回退方法

```
# 删插件装载(改 opencode.jsonc 去掉 media-gen 那行,或还原 .bak)
# 代码全在 feat 分支,未合 main;弃用直接弃分支即可
git branch -D feat/media-gen-alibaba   # 若已合 main 则 git revert 上述 8 笔
```
