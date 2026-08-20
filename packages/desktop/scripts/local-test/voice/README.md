# voice —— 语音派活(REQ-102)测试装置

对应 `docs/features/voice-dispatch-minimal/1-spec.md` §4·S0。

## 为什么在这儿

前一轮 spike 的装置全放在 `/tmp/qwen-spike/`,**机器一重启就全没了**(2026-08-20 核实:目录已不存在,六个脚本连同复现能力一起丢),而那批脚本是"语音链路能不能自动回归"的唯一支撑。所以这次落进仓里,跟 `repack-local.sh` 一样就近放在 `packages/desktop/scripts/local-test/`。

## 一条铁律:必须用 `bun` 跑

两个原因,缺一不可:
- 脚本要 `import` 主进程侧的 TS 模块(`src/main/deskfox/voice/launch-env.ts`)—— 三钉死只有一份实现,装置和生产共用同一套解析,不许各写各的;
- DashScope 探针要给 WebSocket 加 `Authorization` 头,node 的全局 `WebSocket` 不支持自定义 header。

## 环境:装置会自己补 XDG

主进程在起 sidecar 前会把 `XDG_DATA_HOME` / `XDG_CONFIG_HOME` 指到 deskfox 命名空间;**裸终端没有这一步**。不补的话装置读到的是旧命名空间那份 `auth.json` / `opencode.db` —— 验的根本不是上线后那套环境(2026-08-21 实测踩到)。`applyVoiceHarnessXdg()` 负责补齐,已显式设过的一律尊重。

## 四件套

### make-audio.sh —— 合成中文测试音频

```bash
bash make-audio.sh "你好千问" /tmp/v-wake.pcm
bash make-audio.sh "帮我在当前项目里新建 patch.txt,写一行 hello from voice" /tmp/v-task.pcm
```

产出 PCM16 / 16kHz / 单声道裸流。音色写死 `Tingting` 并做时长校验 —— `Eddy` 等 zh_CN 音色未安装时只会产出 0.016s 空音频,spike 踩过这个坑。

### ws-realtime-probe.mjs —— realtime 模型可用性 / 默认档位探针

```bash
bun ws-realtime-probe.mjs                                  # 探 1.11.0 catalog 四档
bun ws-realtime-probe.mjs qwen-audio-3.0-realtime-plus      # 只探指定的
```

只建连、不发音频、不产生推理费用。除了"有没有权限",还会把服务端回报的**默认音色 / 转向检测 / modalities** 打成表 —— D-F 的前端模型 A/B 要的就是这些实测值,而不是文档上的说法。

2026-08-21 实测:四档全通;两个 plus 档的服务端默认 `turn_detection` 都是 `server_vad`(qwen 客户端会再按模型族覆写成 `smart_turn` / `semantic_vad`,见 `shared/realtime-model-catalog.mjs`)。

### acp-handshake.mjs —— ACP 宿主握手 + 噪声基线

```bash
bun acp-handshake.mjs --isolate     # 落临时 XDG,不碰真数据(先用这个)
bun acp-handshake.mjs               # 真环境(⚠️ 见下)
```

按 `resolveAcpHost()` 解析出的命令真起一个 ACP、发 `initialize`,并统计 stdout 里的**非协议行** —— 那正是 S1 wrapper 要滤掉的噪声(spike 时代 55 行里 54 行是噪声)。

宿主是 **本仓 1.x 源码入口**(D-G):`bun <repo>/packages/opencode/src/index.ts acp`。**不是** `resources/opencode-cli` —— 那个是 opencode2/v2 世代,实测落 `opencode-next.db`,用它则语音派的活在 DeskFox 里看不见。

> ⚠️ **S1 门控落地前别跑非隔离模式**:那会加载飞书插件、拉起 5 条 WSS 跟主实例抢消息,直接违背「测试绝不影响飞书」。隔离模式下噪声必然是 0(没有插件),真实基线等 S1 之后再测。

### voice-e2e.mjs —— 唤醒 → 派活 → 执行 → 播报

```bash
bun voice-e2e.mjs --wake /tmp/v-wake.pcm --task /tmp/v-task.pcm \
                  --expect-file ~/项目路径/patch.txt
```

R8 用例 T15 的无人值守版(T15 本身仍要人对着真麦克风说一遍)。**建议永远带 `--expect-file`**:只看 `task.completed` 会被 REQ-102 D10 那条「工具静默跳过 + 假报成功」骗过去,落盘校验才是真判据。

### voice-e2e2.mjs —— 打断 + 并发派活

```bash
bun voice-e2e2.mjs --wake /tmp/v-wake.pcm --long /tmp/v-long.pcm --stop /tmp/v-stop.pcm \
                   --taskA /tmp/v-taskA.pcm --taskB /tmp/v-taskB.pcm
```

打断默认走**真语音插话**(`--barge voice`);`--barge frame` 改成直接发 `interrupt` 帧,用来区分"是 VAD 没听见"还是"服务端没响应"。并发那半段会把两次派活的时间戳打出来 —— REQ-102 D9 的遗留项(两个 task 是否真有时间重叠)靠它来回答。

## 前置:Gateway 得先起来

```bash
qwenaudio gateway status
qwenaudio gateway start --backend opencode     # 参数固化在 S2,届时由 DeskFox 主进程注入
```

## 协议锚点(1.11.0,别照 1.7.0 的记忆写)

| 事 | 位置 |
|---|---|
| 客户端 / 服务端事件全集 | `shared/realtime-events.mjs` |
| 参考客户端(音频帧写法) | `tui/src/index.mjs:1181` — `{type:'audio.append', audio:<base64>}` |
| realtime 模型四档 + 各族默认转向检测 | `shared/realtime-model-catalog.mjs` |
| 后端 env 逃生阀 | `scripts/opencode.mjs` |

全局安装路径:`$(npm root -g)/qwen-audio-agent`。
