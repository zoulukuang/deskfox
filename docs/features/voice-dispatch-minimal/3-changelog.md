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
