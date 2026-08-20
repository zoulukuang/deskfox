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

## 待实测项(施工中填结论)

- [ ] `OPENCODE_CONFIG_CONTENT` 与继承的 `opencode.jsonc` 是覆盖还是 merge
- [ ] webui 能否内嵌成 Electron 窗口(不能就走外部浏览器,本期不纠结)
- [ ] qwen-audio-agent 1.11.0 相对 1.7.0 的锚点漂移清单
- [ ] R1:主实例 + 语音同开 `opencode.db` 的实际表现
- [ ] R2:anthropic OAuth 刷新竞态是否真会掉登录

## 开发中 note

(施工时追加)
