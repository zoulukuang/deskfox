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
