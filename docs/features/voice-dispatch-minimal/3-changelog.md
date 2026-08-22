feat-id: voice-dispatch-minimal
status: spec
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 语音派活最简自用版(REQ-102)— 3-changelog

> commit 后填。骨架先建,防止事后补。

## 实际改动

(逐 commit 明细待 merge 前统一回填 — hash / 文件 / 行数 / 影响范围;
决策轨迹与施工记录已实时落在 `2-plan.md`,不重复。)

## 回归测试

(T1–T20 逐条结果待 merge 前回填。当前:voice 模块 95 单测绿、`@opencode-ai/desktop` typecheck 绿;
真机「首次空库起语音」自愈链路已实测通过,详见 `2-plan.md`「真机第 2 轮」。)

## 已知问题

- **`claude-code` provider 拿不到任何 MCP 工具** → 已修(在 plugin 仓,不在本仓)。
  它 spawn `claude` CLI 并让 CLI 用自己那套内置工具,opencode 交给它的 71 个工具(含 54 个 MCP)
  一个都没透传下去;影响**不止语音**,任何走 `claude-code` 的会话都用不了 MCP(`macro` 同理)。
  两侧各修一半:语音默认模型换 `alibaba-cn/qwen3.8-max`(本仓);
  `/Volumes/ExtSSD/deskfox-plugins/claude-code/` 分支 `feat/mcp-passthrough` commit `4c4c27d`
  把 opencode 配置里声明的 MCP 透传给 CLI(`--mcp-config`)。
  动态注册的 MCP(ACP `session/new` 带进来的)由 B2 覆盖:wrapper 旁路抄帧 → `DESKFOX_DYNAMIC_MCP_FILE`
  → plugin 合并。**零上游改动、零 R4**(原以为要改 `session/llm.ts`)。
  实测 `claude-code/opus` 也能走第三层 session。
- ~~第三层 session 标题是英文~~ → 已修:`buildVoiceConfigContent` 覆盖 `agent.title.prompt`
  (`VOICE_TITLE_PROMPT`),硬性要求简体中文。内置那版写的是「跟随用户语言」,但语音链路里首条 prompt
  是 coordinator 转写过的、常已是英文,跟随等于跟错。
- **唤醒词模型要手工装一次**:`ensureWakeWordModel` 直连 GitHub 下 32MB,实测下到 19MB 就超时。
  已用 `curl -C -` 续传装好(sha256 与代码里的常量一致),之后 0ms 复用不再联网。
  换机器 / 清了 `~/.config/deskfox/qwaudio/models/` 需要重来一次;
  装的位置是 `models/wake-word/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20/`(**要带模型名那层**)。
- **唤醒词文案改不了**:qwen 把「你好千问」硬编码在 `core/config.mjs:490`,无 env 覆盖。
  实际检测认 `keywords.txt`,所以换词可行但提示文案会对不上,且改 node_modules 升级即失。
- **闲聊不进语音沟通记录**:纯问答不产生 task,journal 的数据源是 /api/tasks + /api/timeline,
  所以覆盖不到。要补得连 gateway 的 WS 收 transcript.final(realtime 连接有状态,有干扰风险,故未做)。
- **默认后端 2026-08-22 换回 `claude-code/opus`**(user 拍板)。前提是 plugin 侧 B1+B2 已让
  claude-code 能拿到全部 MCP 工具(含第三层 Session 能力),实测第三层照常建起。
  两个代价:① **必须有代理**,从 Dock 启动的 GUI 进程没有代理变量 → 任务会全部 403;
  ② 走 Claude 订阅额度。切回国产:`DESKFOX_VOICE_BACKEND_MODEL=alibaba-cn/qwen3.8-max`。
- **国产模型有内容审查**:`alibaba-cn/*` 走 DashScope,涉国际政治 / 军事条款类话题会被
  `DataInspectionFailed` 拒(实测 4 个任务失败 2 个)。不是 bug,是换模型的代价。
  B2 落地后可按话题切 `DESKFOX_VOICE_BACKEND_MODEL` 规避,coordinator 会自动作废重建。
- **首次起语音可能重试一次**:库还没建好时,qwen 的 backend server(4396)与 ACP 宿主会并发建表撞一次,
  第 2 轮才成(实测总耗时 ~4s,用户无感)。共用主实例的库时库早已建好,不会碰到;
  只有走 `DESKFOX_VOICE_ISOLATE_DB=1` 逃生口首次开新库才会。根治要预热库,本期不做。
- **Dock / Finder 启动可能没有代理**:GUI 进程不继承 shell 的 `~/.zshenv`,主进程身上没有代理变量时
  我们也无从 carry,后端 `claude-code/opus` 会以 403 收场。当前靠启动日志里的软警告暴露;
  彻底解法(从 `session.resolveProxy()` 反推)本期不做。
- **`voice-e2e.mjs` 装置失效**:连上 WS 后直接灌音频、缺 configure 握手,灌进去无反应。
  产品链路(WebUI + 真麦克风)不受影响,装置待补。

## 回退方法

见 `1-spec.md` §8。
