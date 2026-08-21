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
  **仍未覆盖**:运行时动态注册的 MCP(ACP `session/new` 带进来的那些)只在 opencode 进程内存里,
  配置文件读不到 —— 要覆盖需在 `session/llm.ts` 的 `_opencode` providerOptions 通道加字段,那要一笔 R4。
- ~~第三层 session 标题是英文~~ → 已修:`buildVoiceConfigContent` 覆盖 `agent.title.prompt`
  (`VOICE_TITLE_PROMPT`),硬性要求简体中文。内置那版写的是「跟随用户语言」,但语音链路里首条 prompt
  是 coordinator 转写过的、常已是英文,跟随等于跟错。
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
