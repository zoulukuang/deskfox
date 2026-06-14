---
feat-id: media-gen-alibaba
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 多模态生成 — 阿里全能力适配 — plan / 决策轨迹

> 完整长期规划见 REQ-030。本 plan 记本竖切的实施路线 + 实施中踩坑/方案推翻轨迹。

## 实施路线(实际)

采用"**先内环验 API、再外环接 UI**"的去风险打法,而非先建框架:

1. **第一竖切(文生图)**:新建 `packages/media-gen` 骨架 + `dashscope-image.ts` 直白实现 + `media_image_generate` 工具 + `probe.ts` 内环脚本。先用 probe 真 key 打通 DashScope 异步任务。
2. **全能力发现**:写 `probe-models.ts` / `probe-specialized.ts`,挨个实打候选模型,确认有效 ID + 端点 + 参数(不靠猜)。
3. **重构 + 补齐**:从文生图里抽出共享异步任务引擎 `dashscope-task.ts`(submit→轮询→终态),再补视频/翻译/语音合成/语音识别 + 5 工具入口。
4. **本地文件支持**:user 实测本地文件失败 → 加 `dashscope-upload.ts`(OSS 上传)。
5. **改图模型纠偏**:user 实测改图无效 → 探出并换用 `qwen-image-edit`。

## 决策轨迹(踩坑 / 推翻)

| # | 事件 | 结论 |
|---|---|---|
| 1 | 文档原写模型 `wan2.6-t2i` | ❌ 实测报 `InvalidParameter: url error`,**证伪**。改用 `wanx2.1-t2i-turbo`(实测 12.6s)。**教训:模型 ID 必探不猜。** |
| 2 | 第 1 周是否"先建 core 全套" | ❌ 推翻 REQ-030 原 §10。改"先竖切打穿不抽象",通用层等第二家逼出来(REQ-030 §0.1 第 1 条)。 |
| 3 | 是否用 Tauri/Rust 做下载缓存 | ❌ 砍掉。插件跑在 opencode 边车进程,**调不到 Tauri 命令**(进程隔离);下载用 JS 即可。MVP 0 行 Rust。 |
| 4 | bundle 把 `tool` 从 @opencode-ai/plugin 导入 | ⚠️ 会拖入巨大的 `effect`。改用本地 `tool-shim.ts`(结构兼容 ToolDefinition),type-only import 类型。 |
| 5 | TTS 是否要 CosyVoice WebSocket(REQ-030 原担心) | ✅ 绕开。`qwen-tts` 走同步 multimodal-generation 端点直接返回音频 url,无需 WebSocket。TTS 由二期降一期。 |
| 6 | 本地文件(file:///)直接传给阿里 | ❌ 云端够不着本地文件(user 实测"解码错误",AI 误判成 MP3 格式问题)。加 OSS 上传(getPolicy→multipart→`oss://`+`X-DashScope-OssResourceResolve` 头)。 |
| 7 | 改图说"替换背景"AI 不调工具 | 工具名 `media_image_generate` 含 generate,模型不往"编辑"上路由(§13.1)。**拆出专用 `media_image_edit`** 修路由。 |
| 8 | 改图模型 `wanx2.1-imageedit` 效果 | ❌ 把"换背景"理解成重画对象、背景没变(下载结果图用 Read 工具**亲眼验证**)。换 `qwen-image-edit`:正确替换背景且保留对象(亲验)。改图本地图转 base64 data URI(连上传都省)。 |

## 调试套路沉淀

- **内环 probe 先行**:每个能力先写独立 probe 脚本用真 key 实打,确认 ID/端点/响应结构,再接工具。比"边写工具边在 DeskFox 里调"快一个数量级。
- **结果图下载 + Read 工具看**:OSS 图片/视频是公网链接,下载到本地用 Read 工具能亲眼判画质对错(改图选型靠这个定案,见 #8)。
- **改插件后必杀边车**:只关 DeskFox 窗口不够,`opencode-cli` 边车进程残留跑旧插件;须 `Stop-Process opencode-cli` 后重开才加载新 `dist`。

## 协议形态(适配第二家时的抽象依据)

阿里 6 能力共 3 种协议,这是接 minimax 后抽通用层的关键参照:

1. **异步任务**(submit→轮询 `/tasks/{id}`):文生图 / 改图(wanx 路径已弃)/ 文生视频 / 图生视频 / 语音识别 — `dashscope-task.ts` 已封装。
2. **同步 chat**(OpenAI 兼容 `compatible-mode`):翻译。
3. **同步多模态生成**(`multimodal-generation/generation` 直接返回 url):语音合成 / **改图(qwen-image-edit)**。
