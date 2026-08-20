feat-id: voice-dispatch-minimal
status: spec
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 语音派活最简自用版(REQ-102)— 2-plan

> 施工计划 + 决策轨迹。**开发中实时追加 note**(踩坑 / 方案推翻 / 与 spec 的偏差)。
> spec 未审签前不动代码。

## 施工顺序(四笔 commit,各自可 revert)

| # | commit | 内容 | 依赖 |
|---|---|---|---|
| 1 | `chore(desktop): 语音派活测试装置重建 + 三钉死` | S0 | — |
| 2 | `feat(adapter-feishu-lark,media-gen,desktop): ACP 插件自门控 + stdout wrapper` | S1 | 1(要用装置验) |
| 3 | `chore(desktop): 语音启动参数固化 + 拆除 1.17.4 时代绕法` | S2 | 2 |
| 4 | `feat(app,desktop): 顶部栏语音入口` | S3 | 3 |

## 决策轨迹(立项期)

- **2026-08-20 · D-A 共用命名空间**:候选三选一(共用 / 完全隔离 / 共数据隔配置)。选共用的决定性理由是会话可见性 —— sessions 按 `directory` 绑 project(`schema.gen.ts:13/101`),共用 + `OPENCODE_WORKSPACE` 指真实项目 ⇒ 语音派的活直接落进 DeskFox 当前项目的会话列表,这是最接近 Codex 的一点,且零成本。代价(同库并发 / token 刷新竞态)转为 R1/R2 验收项。
- **2026-08-20 · D-B fork 包自门控**:原计划要改 `packages/opencode/src/plugin/index.ts:179`(全仓唯一插件加载收口点)。核实 `acp.ts:23` 设 `OPENCODE_CLIENT` 早于 `Server.listen`(:25)后,发现在 fork 自有插件入口判定即可达到同等效果,R1 停在第 1 级。放弃的能力:第三方插件仍会在 ACP 子进程加载(自用阶段无第三方插件)。
- **2026-08-20 · D-E wrapper 而非改 acp.ts**:原复核结论是「进程内覆写 console.* + patch write」。写 spec 时对照 R1 第 1 级重新审视,发现 `OPENCODE_BIN` 本身就是注入点 ⇒ 管道级过滤可完全在新文件完成。附带三个好处:源无关(连 native 写 fd 1 也拦得住)、上游 sync 永不冲突、不改变 `opencode acp` 对其他消费方的行为。**本批因此变成 0 上游内核改动、0 R4 override。**
- **2026-08-20 · 版本锁定**:qwen-audio-agent 1.7.0 → **1.11.0**(本机现装 1.7.0,npm latest 1.11.0)。理由与回退位见 1-spec §2。
- **2026-08-21 · D-F 模型三选**(user 授权「你来选,目标效果最好」):后端 `anthropic/claude-opus-5` 保持;**新增 small_model = `alibaba-cn/qwen-flash`** —— `config.ts:77` 说明 small_model 只做标题生成这类杂活,拿 Opus 订阅额度去烧它是纯浪费,而 qwen-flash 输入价是 qwen3-max 的 1/39 且走独立 API key;前端默认锁 `qwen-audio-3.0-realtime-plus`(1.11.0 官方默认 + audio 族配 `smart_turn` 正对症 spike 的尾巴截断 + omni 族的图片输入优势被本版传输层关闭),并在 S0 内做一次真音频 A/B 对 `qwen3.5-omni-plus-realtime` 定终选。顺带作废旧风险:`qwen3-omni-flash-realtime`(疑似 8 轮上限)已不在 1.11.0 catalog 中。

- **2026-08-21 · D-G ACP 宿主改走本仓 1.x 源码入口**(user 拍板)。S0 施工中实测推翻了原方案「OPENCODE_BIN = 内置 sidecar」的前提:① 装好的 `/Applications/DeskFox.app` 的 Resources 里**没有任何 opencode CLI**(生产是 `utilityProcess.fork(sidecar.js)`,`server.ts:77`);② dev 树那个 `resources/opencode-cli` 是 **opencode2 / v2 世代**,隔离 XDG 实测 acp 落 **`opencode-next.db`** —— 用它则 D-A 的会话可见性归零;③ `bun packages/opencode/src/index.ts acp` 实测握手正常(`protocolVersion:1` / `agentInfo: OpenCode local`)且与 app 共用 `opencode.db`。代价:装好的 app 依赖本机源码树(→ 风险 R5,语音入口据此禁用而非静默失败);产品化路径 = 编译 1.x CLI 二进制随包带。
- **2026-08-21 · 版本号不再作为准入判据**。三处实测:源码态 `local` / 内置 v2 二进制 `0.0.0-next-16350` / homebrew `1.17.4`。原设计的 fail-closed 版本闸会**误杀正确的宿主**,改为身份靠 `resolveAcpHost` 路径构造保证、版本仅告警(唯一硬拦:干净 semver < 1.18.0)。

## 待实测项(施工中填结论)

- [ ] `OPENCODE_CONFIG_CONTENT` 与继承的 `opencode.jsonc` 是覆盖还是 merge
- [ ] webui 能否内嵌成 Electron 窗口(不能就走外部浏览器,本期不纠结)
- [ ] qwen-audio-agent 1.11.0 相对 1.7.0 的锚点漂移清单
- [ ] R1:主实例 + 语音同开 `opencode.db` 的实际表现
- [ ] R2:anthropic OAuth 刷新竞态是否真会掉登录
- [ ] **非隔离 stdout 噪声基线**:`acp-handshake.mjs` 在隔离 XDG 下噪声 0 行(没插件);真实基线要等 **S1 门控落地后**才敢跑 —— 现在跑非隔离会把飞书 WSS 拉起来,违背「绝不影响飞书」
- [ ] **前端模型 A/B**:`qwen-audio-3.0-realtime-plus`(smart_turn)vs `qwen3.5-omni-plus-realtime`(semantic_vad)—— ASR 保真 / 打断时延 / 派活成功率三项,结论回填 1-spec §2.1
- [ ] `small_model = alibaba-cn/qwen-flash` 是否真只吃标题生成这类调用(抽样查 Opus 侧调用量,确认杂活没走主模型)

## 开发中 note

(施工时追加)
