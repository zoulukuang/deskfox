feat-id: release-closeout-2026-09
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实施计划 + 决策轨迹

> 1-spec 已于 2026-09-17 user 审签锁版。施工按 spec §6 次序:S1 → S2 → S4a → S4b → S3 → S5 → S6。
> **user 追加要求(2026-09-17)**:每个模块开发完先跑完测试,再进下一个模块;最后做整体回归。
> 本文开发中实时追加 note,记踩坑与方案推翻。

---

## S1 · REQ-132 构建版本号注入 — ✅ 已完成(代码 + 测试)

### 落点

| 文件 | 改动 |
|---|---|
| `packages/branding/scripts/build-deskfox-electron.sh` | `export OPENCODE_CHANNEL="$ENV"` 之后插 FORK-BEGIN/END 块:读 `packages/opencode/package.json` 的 `.version` → 校验 → `export OPENCODE_VERSION` |
| `packages/branding/scripts/build-deskfox-electron.ps1` | 同上,逐项对偶(PowerShell 写法) |
| `packages/branding/__tests__/build-version-injection.test.ts` | **新增 16 条**测试 |

两处均为 fork 自有脚本,**零上游文件改动、零 R4 override**。

### D1 · 取值手段选 `bun -e`,不用 `node -p`

CI runner 不保证有 `node`,但构建本来就依赖 `bun`(下一行就是 `bun run build`),`bun` 必在 PATH。
Win 侧用 `Get-Content -Raw | ConvertFrom-Json`(PS 内置,无外部依赖)。

### D2 · 🔴 测试当场抓出一个设计漏洞:`0.0.0-*` 是合法 semver

原方案只校验 `^\d+\.\d+\.\d+(...)?$`。写测试时把「`version` 就是坏值 `0.0.0-prod-202608190542`」当失败用例列进去,**跑出来是绿的(即通过校验被注入)** —— 也就是说,假如 package.json 里哪天真出现 `0.0.0-*`(上游改推导 / 合并事故 / 手误),这道闸会照单全收,本需求原地复发。

**修正**:在 semver 校验之后补一道**显式 `0.0.0*` 拦截**,两侧都加。这条是 D-B「fail-fast」精神的具体落实 —— 格式对不代表值对。

> 教训沉淀:这正好印证了 spec §5.2「不接受纯源码复核」。这个洞读三遍代码都看不出来,写成用例跑一次就现形。

### D3 · S1.4 版本号消费点逐处回归 — 结论:桌面链路无风险

| 消费点 | 结论 |
|---|---|
| **TUI 自动升级**(`cli/upgrade.ts`)| **走不到**。唯一触发者是 `cli/cmd/tui.ts:266` → `cli/tui/worker.ts:61`;而 DeskFox sidecar 入口是 `src/node.ts`(只导出 `Config`/`Server`/`bootstrap`/`Database`,`bootstrap.ts` 内无 upgrade),electron-builder `files: ["out/**/*","resources/**/*"]` 也不含任何可被用户直接拉起的 CLI/TUI 可执行入口。**故不需要置 `OPENCODE_DISABLE_AUTOUPDATE`** |
| **daemon / 看门狗版本严格相等判定** | **不存在该判定**。`sidecar-watchdog.ts` 只看 healthy,不比对版本;`global.ts:75` 的 health 端点只是**上报** `version`,无相等分支。spec R1 里这条风险按「已核实不成立」出清 |
| **`session.version`** | 由 `0.0.0-prod-<每次构建都变>` 变为稳定的 `1.18.16`,语义变正确;老会话字段不回填,不影响打开 |
| **provider User-Agent** | 本需求的目标本身 |
| **`InstallationChannel`** | 不受影响(来自 `OPENCODE_CHANNEL` define,S1.3 未动) |

**顺带的正向效果**:旧行为下版本号含时间戳、每次构建都变;现在稳定,凡是按版本号做缓存/复用判定的地方都从"永不命中"变成"正常命中"。

### D4 · S1.5 updater 清单隔离 — 已核 + 已加自动断言

`packages/desktop/scripts/finalize-latest-{yml,json}.ts:12/22` 同名读 `process.env.OPENCODE_VERSION`,但它们要的是 DeskFox 日历号(`installer-versions.json`,如 `2026.11.1`),不是上游基线号 `1.18.16`。

已核:两份 build wrapper **都不调**这两个脚本(updater 清单走 `deploy-updater-manifest.sh` / `bridge-electron-updater.sh`,版本号由 `--version` 显式传参)。
**并加了测试固化**(「OPENCODE_VERSION 不得外泄到 updater 清单链路」):两份 wrapper 里出现 `finalize-latest-*` 字样即红。同时注释写明「只在本脚本内部 export,绝不写进 .env / 外层 shell」。

### 测试结果

```
packages/branding: bun test
 77 pass  0 fail  195 expect() calls  (5 files)
```
其中新增 16 条(`build-version-injection.test.ts`)。覆盖:
- ① 正常取值 / 预发布号(`1.19.0-rc.1`)放行
- ② fail-fast 六种:字段缺失 / 空串 / 非 semver / **`0.0.0-*` 坏值** / JSON 损坏 / 文件不存在
- ③ 不碰 `OPENCODE_CHANNEL`;不外泄到 updater 清单
- ④ Mac/Win 对偶五项:都有注入块 / 同一取值源 / 同一 semver 正则 / 都 fail-fast / 注入点都在 `bun run build` 之前 / 都有 `0.0.0` 闸

> ①② 跑的是**从脚本里抽出的真代码块**(`FORK-BEGIN…FORK-END` 之间),在临时假仓库上真跑 bash,不维护副本 —— 脚本改了测试自动跟着改。

### 遗留到 S6(产物层,本阶段做不了)

- **S6.1** dump `app.asar` 断言 `InstallationVersion = "1.18.16"`,不含 `0.0.0-`
- **S6.2** Console 免费额度真发消息
- **S6.3** 造取值失败 → 构建报错退出(单测已覆盖逻辑,S6.3 验的是**真构建**里也如此)
- **S6.6** Win 端同验(Win wrapper 改动本机跑不了)


---

## S2 · REQ-100 停止键空转 + 消息静默蒸发 — ✅ 已完成(代码 + 测试)

### 落点

| 文件 | 改动 |
|---|---|
| `packages/app/src/utils/server-compat.ts` | `prompt` 增第二参 `requestOptions`(只为 `AbortSignal`),v1 路径透传给 `promptAsync` |
| `packages/app/src/components/prompt-input/submit.ts` | 送达超时闸(abort + race)· `PromptNotDeliveredError` · 失败处置分流 · 停止键本地兜底 |
| `packages/app/src/components/prompt-input/comment-restore.ts` | **新增**纯函数:引用卡片回吐的字段映射(含原先漏传的 `kind`) |
| `packages/app/src/context/global-sync/stale-busy.ts` | **新增**纯函数:残留 busy 判定 |
| `packages/app/src/context/server-sync.tsx` | 后端权威全量忙闲对账(`server.connected` + 60s 周期)· 清死变量 `bootingRoot` |
| `packages/app/src/context/server-session.ts` | `optimistic.pending(sessionID)` —— 对账的竞态护栏 |
| `packages/app/src/i18n/*.ts`(62 个) | 3 条新词条,en/zh/zht 真译,其余按仓内惯例 en 兜底 |

零上游文件改动、零 R4 override(`packages/app` 全在白名单)。

### D5 · 🔴 第二次被测试推翻:只 abort 不够,必须 abort + 本地 race

原实现:超时 → `AbortController.abort()` → 指望底层 fetch 拒绝 → 走既有 catch。
写 T9 时用「忽略 signal 的假 client」跑,**四条断言全部超时挂死** —— abort 只有在下游肯听 signal 时才生效。

回头看真实链路,这不是测试假设苛刻,而是**真实的一支**:`api.prompt` 经 `server-compat.ts` 的
`lazyApi` 代理,调用被包在 `implementation.then(...)` 里,而 `implementation` 来自 `input.protocol`
这个 Promise。**后端不可达时协议探测本身就可能挂住,abort 压根传不到 fetch。**
本需求的病灶恰恰就是"后端半死",这一支不是边角情形,而是主场景。

**修正**:两件事都做 —— `delivery.abort()` 掐断请求(防回吐后迟到落地造成双份)+ 一个独立的
deadline Promise 直接 reject(**不依赖任何人肯听 signal**),`Promise.race` 取先到者。
迟到的 `delivered` 挂 no-op catch 防未捕获拒绝。

> 与 D-E 拍板不冲突:拍的是"(a) 超时 + abort 请求"这条路线,这里只是把它实现对 ——
> 少了 race 那一半,这条路线在真实链路上根本不成立。

### D6 · 忙闲对账改成不按目录切(而非只删那道 active 闸)

spec S2.1 给了两个选项,施工时选了后者「后端权威全量忙闲表」,理由是读码发现**第二层根因**:

- 第一层(需求 doc 已定位):`server.connected` 分支的 `if (!children.active(directory)) continue`
  让被 evict 的目录拿不到对账。
- **第二层(本次新发现)**:即便绕过第一层,`seedActiveSessionStatuses` 也救不回来 ——
  它头一行就是 `if (session.data.session_status[sessionID] !== undefined) continue`,
  **只填本地缺失的条目,对"本地 busy、后端 idle"的残留一个字都不改**。它是 seed,不是 reconcile。
  真正能清残留的只有按目录 bootstrap 的全量替换,而那条正好被第一层挡住了。

两层叠加,才造成 REQ-100 doc 里那句「代码在、类型对、也确实被执行了,但恰好跳过了出事的那一个」。

**修法**:忙闲本就是**会话**维度,后端 `SessionStatus`(`packages/opencode/src/session/status.ts`)
本来就维护着一张全局表,且**只存非 idle 项**(`set` 到 idle 会 `delete`,`get` 缺失返回 idle)——
所以「不在表里 = idle」是后端的确定语义,不是猜测;它还是 per-instance 内存态,sidecar 一 respawn
表就是空的,正对应"该清干净"。于是直接拿这张表做权威覆盖,完全不按目录切。
按目录的 `queue.push` 循环**保留原样**(它还负责 bootstrap 其他数据),只是忙闲不再依赖它。

**竞态护栏**:刚发出的消息有个窗口 —— 前端已乐观置 busy,后端还没登记进 status 表。
此时对账撞进来会把正在发送的会话错误清掉。故新增 `session.optimistic.pending(sessionID)`:
有未确认的乐观消息 = 这一发还在飞,对账跳过。

### D7 · S2.2c 回吐的静默分支

原代码 `if (restoreInput()) restoreCommentItems(...)`:用户在失败前已另起输入时 `restoreInput()`
返 false,**引用卡片就地蒸发且无任何提示**。
改为:原文不覆盖(不抢用户正在打的字),但引用卡片是**追加**语义,无论如何都还回去;
toast 文案分流成两条,明确告知"原文未覆盖"。

### D8 · 停止键兜底读写走 `sync()` 而非 `serverSync()`

`session.tsx:1009` 的 spinner 读的是 `sync().data.session_status`,兜底就写同一个 store,
免得写了一个 store、转圈的是另一个。4s(spec 定 3–5s 取中位),仅在仍为 busy 时才置 idle。

### 测试结果

```
packages/app: bun run typecheck   → 通过
packages/app: bun run test:unit   → 1089 pass  0 fail  (141 files)
packages/app: bun run test:browser→   41 pass  0 fail  ( 14 files)
```

新增 20 条:
- `stale-busy.test.ts`(8 条):后端缺席=idle / 后端说忙不清 / 非 busy 不动 / **乐观在飞不清** /
  **被 evict 目录名下会话照样被对账到(REQ-100 复现)** / 多残留一次清 / 空表
- `comment-restore.test.ts`(5 条):**聊天引用 kind 保真(漏传复现)** / 文件引用全字段 /
  preview 不丢 / 字段无遗漏看门狗 / 可选字段缺席不炸
- `submit-delivery.test.ts`(7 条):**挂住→超时抛 PromptNotDeliveredError** / 撤乐观消息 /
  busy 归 idle / **真的 abort 了请求** / 正常返回不误伤 / 后端明确报错原样上抛不冒充"未送达" /
  `isPromptNotDelivered` 不误判

### 遗留到 S6

- **S6.4 真机**:kill 后台子进程 → UI ≤N 秒复位 / 发带引用卡片的消息 → 原样回输入框 + toast /
  时间线不残留 / 后端恢复后不自动重发
- 弱网 + 大附件各验一次,确认 20s 不误伤"活着但慢"的后端(spec R5)


---

## S4a · REQ-131 引用卡片能看到引文原文 — ✅ 已完成

`5ed5325f6a`。四个断点同一笔改完(spec R4)。落点:`rows.ts` / `message-part.tsx` /
`comment-card-v2.tsx` / `dom-provider.ts` 注释订正。

### D9-a · `MessageComment` 抽到独立文件,理由是可测不是洁癖

`rows.ts` 经 `@opencode-ai/session-ui/message-part` 牵进 `markdown.worker`(vite `?worker&url`),
`bun test` 直接 import 报 `Missing 'default' export`。这段是纯数据提取,不该被渲染层的构建期依赖
绑架 → 移到 `message-comment.ts`,`rows.ts` re-export 保持路径不变。

### D9-b · 聊天引用副标题不新增 i18n 词条

原设想给 `kind==="chat"` 显一个静态标签「引用对话」,但 `session-ui` 的 `useI18n` 键类型是
`keyof typeof packages/ui/src/i18n/en`,加键就要动黑名单 `packages/ui`。
改为**显引文首行** —— 既不需要新词条,信息量还更高(它才真正说明"引的是哪段");
引文为空(老消息)才回落静态词。

---

## S4b · REQ-125 会话标题剥壳 — ✅ 已完成(🔴 本批唯一 R4 override)

`f123503078`。复核报告见 [`R4-override-复核报告.md`](./R4-override-复核报告.md),user 2026-09-17 批准。

要点已在报告与 `3-changelog.md` 展开,此处只记两条施工判断:

- **真源落 `packages/core/src/fork/`**:core 是 app 与 opencode 的共同 workspace 依赖,fork 自建
  新文件享 pre-commit 动态豁免。这一步把「跨包正则重复」这项代价直接消掉了 —— 它本来是 D-D
  修法 A 的第二项代价。
- **迁移逐字节等价**:`git show HEAD:… | sed 's/FileSelection/CommentSelection/g' | diff` 验证,
  spec R8 的风险据此闭合。

---

## S3 · REQ-130 点 × 关标签不再收起预览区 — ✅ 已完成

`f7ee11d0e1`。修法 A(wrapper onClick 认出 × 即 return,v1/v2 两个 sortable-tab 一起改)
+ 修法 C(`decideTabCollapse` 增 `tabStillExists`,纯逻辑兜底可单测)。

A 是 DOM 行为只能 e2e 验、C 是纯函数可单测,两条一起上才同时满足 R5 双清单;
C 对"× 之外任何把 tab 关掉后仍冒出 click"的路径同样有效。

---

## S5 · REQ-128 工具行命中区 — ✅ 已完成

`f077799729`。

### D9 · 🔴 第三次被测试推翻:pointer-events 方案换成 fit-content

需求 doc 的**倾向修法 B** 是「trigger 保持满宽但 `pointer-events:none`,只给文字块与箭头开 auto」。
实现完跑 e2e,**13 条既有用例当场变红**,暴露两个问题:

1. **白名单漏网(真 bug,不是测试问题)**:`.tool-collapsible` 有三个使用方,
   `message-part.tsx` 的 `context-tool-group`(「已运行 N 条命令」「已探索」)**自带 trigger 内容**、
   不走 `basic-tool` 那套 slot,初版白名单没列它 → 整组变成**完全点不开**。
   这类漏网只能靠人肉枚举使用方,每新增一个使用方就多一次静默失效的机会。
2. **「按钮边界」与「可点区域」从此脱节**:`<button>` 仍满宽,只是不吃指针事件。
   既有 e2e 点 trigger 元素的**中心**,而中心落在死区 —— 15+ 处调用点要逐个改成点文字 slot。

改走需求 doc 的**次选修法 A** `width: fit-content` + `max-width: 100%`:
**让按钮本身就等于文字区**,缩到哪儿可点区就是哪儿,两者定义上不可能脱节。

- doc 当初把 A 列为次选的理由是「牵动右侧 action 靠右布局,需逐类型回归」。实测不成立:
  行内是 `justify-content: flex-start`、action 是 `flex-shrink:0` 的 inline-flex、箭头紧跟文字,
  **没有任何 `margin-left:auto` 之类依赖整行宽度的靠右定位**。
- 逐类型回归拿 e2e 做了:**全套 142 条全过**(pointer-events 版是 129 过 13 败)。
- `align-self: stretch` 不会把它拉回满宽 —— 该属性只在 cross size 为 `auto` 时生效,
  显式宽度即让它失效。

> 这是本批第三次「读码觉得对、跑起来不对」。前两次是 S1 的 `0.0.0-*` 合法 semver、
> S2 的 abort 传不到 fetch。三次都印证 spec §5.2 那条「不接受纯源码复核」。

---

## 整体回归(R9 分支内验收闸)

代码六组全部完成后一次性跑完:

| 项 | 结果 |
|---|---|
| `bun turbo typecheck --filter='!./packages/console/*'` | **29/29 successful** |
| `packages/app` `bun run test`(unit + browser) | **1100 + 41 pass,0 fail** |
| `packages/app` `bun run test:e2e` | **142 pass,0 fail** |
| `packages/core` | **1137 pass,0 fail** |
| `packages/session-ui` | **121 pass,0 fail** |
| `packages/opencode` `test/session` | **438 pass,7 skip,0 fail** |
| `packages/media-gen` | **140 pass,0 fail** |
| `packages/adapter-feishu-lark` | **792 pass,0 fail** |
| `packages/branding` | **77 pass,0 fail** |
| `packages/desktop` `src/main/deskfox` | **169 pass,0 fail** |

新增测试合计 **58 条**(S1 16 / S2 20 / S4a 6 / S4b 22 / S3 5 / S5 7,其中 S4b 含 core 14 + opencode 8)。

**尚未做、不能在本机做的**:S6 全部(真构建产物 / Console 免费额度 / 真机 kill 后端 /
GUI 四条真机点击 / Win 端),见 spec §5.2。
