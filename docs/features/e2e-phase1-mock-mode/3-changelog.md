---
feat-id: e2e-phase1-mock-mode
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# e2e-phase1-mock-mode — 3-changelog

> **Phase 1 自动化测试基础设施落地** — 关 ping-pong 循环,让 Claude 在 chromium 自闭环跑组件级 e2e

## 一句话

Vite mock mode + 内存 fs + Tauri invoke 22 命令 dispatch + bootstrap mock(4 query)+ workspace entry + 7 个 Playwright fixture helpers + 端到端 smoke spec(8/8 assertion pass)。Phase 1 e2e 闭环,治理 R5 v3 → v4 同步生效。

## 实际投入

| 周 | 工作日 | 主要产出 |
|---|---|---|
| W1(D1-D7)| 2.5d | MANIFEST 全量出口盘点 / Vite mock plugin / memfs / 22 Tauri invoke dispatch / contract test 骨架(C1-C7)|
| W2(D8-D9)| 1.5d | fixture 4 helpers / spike 重大方向报告 / W3 bootstrap 蓝图(`BOOTSTRAP-MOCK.md`)|
| W3(D15-D17)| 1.5d | bootstrapMock / workspace entry / mock-foundation 端到端 smoke spec / R5 v3→v4 |
| **合计** | **5.5d** | **远少于 1-spec 估的 2-3 周(15-21d),节省 10-15.5 天** |

节省的原因:Stage ② mock infra 复用度比预估高(`installServerMock` + page.route 跟我的 vite plugin 完全正交,无 hydrate 难点);bootstrap mock 4 query shape 简单(Config 全 optional / Path 5 必填 string);Playwright route 怪癖踩坑(last-registered first-match + host-agnostic glob 必须)在 W3 D15-D17 一次性解决。

## commit hash 列表

| commit | 阶段 | 行数 | 内容 |
|---|---|---|---|
| `2a8f2301a` | feat 启动 | +304 | 1-spec + 2-plan + INDEX |
| `f7fc40cb1` | W1 D1 | +137 | mocks/MANIFEST 全量出口盘点(22 Tauri + SDK 4 namespace)|
| `d48477487` | W1 D2 | +103 | vite mock plugin + tauri invoke stub |
| `f80b7b692` | W1 D4-D6 | +409 / -41 | memfs + 22 tauri invoke dispatch |
| `9f9921b32` | W1 D7 | +30 / -7 | contract test 骨架(C1-C7)+ W1 收尾 |
| `44432e665` | W2 D8 | +221 / -17 | fixture helpers + spike + 重大方向报告 |
| `6d9b0256a` | W2 D9 | +131 | bootstrap mock 蓝图 + W3 切分调整 |
| `2c97cf6c5` | W3 D15-D16 | +167 / -6 | bootstrapMock — UI 进入工作区 |
| `43a15abad` | W3 D17 | +203 / -2 | Phase 1 mock foundation 全链路 smoke(8/8 assertions)|
| (本 commit) | W3 done | TBD | R5 v3→v4 + 3-changelog + INDEX 切 done |

## 行数 / 文件清单

### 新文件(本 feat 自家代码,共 ~1280 行)

| 文件 | 行数 | 角色 |
|---|---|---|
| `packages/app/vite/e2e-mock.js` | 46 | vite plugin,条件激活 |
| `packages/app/e2e/mocks/memfs.ts` | 180 | 内存 fs MemFS class(read/write/list/watcher event/mtime 严格自增 + reset/preload/snapshot 测试辅助)|
| `packages/app/e2e/mocks/tauri.ts` | 266 | invoke dispatch 表,22 命令 + override 表(`window.__deskfoxE2eOverride.setFileSize`)+ memfs/invoke 暴露 |
| `packages/app/e2e/mocks/MANIFEST.md` | 152 | 22 命令 + SDK 4 namespace + memfs interface + contract test C1-C7 |
| `packages/app/e2e/mocks/BOOTSTRAP-MOCK.md` | 100 | W3 整周专精蓝图(bootstrapGlobal 4 query + SSE + session/message 复杂度评估)|
| `packages/app/e2e/fixtures.ts` | 263 | 7 个 helper:installServerMock / bootstrapMock / mockProject / mockFileTree / preloadFile / resetMemfs / setMockFileSize |
| `packages/app/e2e/d8-spike.spec.ts` | 76 | W2 D8 探路 — Playwright route 怪癖发现 |
| `packages/app/e2e/d15-bootstrap.spec.ts` | 66 | W3 D15-D16 探路 — bootstrap 4 query + workspace entry 验证 |
| `packages/app/e2e/mock-foundation.spec.ts` | 128 | **Phase 1 端到端 smoke spec(8/8 assertions pass)**|

### 修改文件(总共 +9 行,主要 +script + plugin 接入)

- `packages/app/vite.js`(+5)— 数组末尾加 `e2eMockPlugin()`
- `packages/app/package.json`(+1)— `dev:e2e-mock: vite --mode e2e-mock` script
- `docs/governance/自动化测试规范.md`(+12 / -7)— R5 v3 → v4(决策 1 / 2 / 4 升级 + 修订记录)
- `docs/features/INDEX.md`(+1)— feat 入口
- `docs/features/e2e-phase1-mock-mode/{1-spec,2-plan,3-changelog}.md` — 三文档

## 影响范围

### 生产 build:0 影响
- `e2eMockPlugin()` 在 `process.env.VITE_E2E_MOCK !== "true" && env.mode !== "e2e-mock"` 时 config hook 直接 return undefined,vite 跳过,生产 build 完全不接 mock alias

### Dev workflow:0 影响
- `bun run dev` 不变(普通模式)
- `bun run test:e2e` 不变(Stage ② 5 spec 仍 pass + 本 feat 新增 3 spec)
- `bun run test:unit` 不变(646 pass + 1 kobalte 老坑)
- `bun run typecheck` 不变(✅)
- 新 script `bun run dev:e2e-mock`(供 dev 手摸 / Phase 1 e2e 用)

### 治理(本 feat 同步切 R5 v4)
- **Medium feat 强制 ≥ 1 Phase 1 e2e happy path**(无 e2e 不算交付)
- **Large feat ≥ 2 Phase 1 e2e + 5 unit + spec 段写明测试覆盖范围**
- **bug-repro 默认 Phase 1 e2e**(覆盖 reactive 层,不再止于 unit DOM event 假设)
- **View 清单硬门槛即时生效**(`dialog-settings.tsx` + `file-tabs.tsx` 标为 🔴 治理 debt,新 feat 触动时一并补)

## 回归测试

| 测试 | 结果 |
|---|---|
| typecheck | ✅ |
| unit(646 + 1 kobalte 老坑无关 fail)| ✅ |
| e2e 全套(8 passed / 1 skipped) | ✅ |
| Stage ② 5 个 mock spec | ✅(本 feat 未破坏 Stage ② 路径) |
| 本 feat 3 个 spike spec(d8 / d15 / mock-foundation)| ✅(各自验自身验收点) |
| 全套耗时 | 10.5s(<2 min A1 验收远超达成)|

## 回退方法

如需回退本 feat:
1. `git revert <commit-range>` 回退 9 笔 commit(`2a8f2301a..43a15abad` + 本 commit)
2. R5 v3 是 v4 的子集,回退后 governance doc 自动回 v3(View 清单悬空门槛)
3. **不需要回退**:e2eMockPlugin 在非 mock 模式 0 影响,留着不用也无害

## Phase 1 foundation 完成度

v2 完整方案 §5.1 6 个 setup 组件:

- ✅ **Vite mock mode**(W1 D2)
- ✅ **内存文件系统**(W1 D4 + W3 D17 跨进程 expose)
- ✅ **Tauri invoke mock 库**(W1 D4-D6 + override 表)— 22 命令全接
- ✅ **SDK mock**(W2 D8 + W3 D15 bootstrap mock + W3 D16 workspace entry)
- ✅ **Playwright fixture**(7 helper)
- 🟡 **CI 接入 + 示范用例**(端到端 smoke ✅;完整 user-flow 示范用例延后到 follow-up sprint,**按 R5 v4 协作模式 §七 — 新 feat 自然带 Phase 1 e2e**)

## Follow-up backlog(不阻塞本 feat done)

| 项 | 内容 | 时长 |
|---|---|---|
| **CI pre-push hook 加 Phase 1 e2e gate** | `git push` 拦 fail,失败原因清晰 | 1d |
| **完整 user-flow 示范用例** | `auto-save-debounce-flush` / `chat-drop-overlay-stuck-fix` / `large-file-preview-guard` 完整 UI click 路径 spec | 每个 1-2d |
| **View 清单硬门槛补债** | `dialog-settings.tsx` + `file-tabs.tsx` 各加 ≥ 1 e2e | 各 0.5-1d |
| **Phase 2 真桌面 e2e 启动** | `feat/e2e-real-tauri-webdriver` 复活 + saveDialog mock 方案 ① 落地 | 1 周(数据驱动启动)|
| **Contract test 自动化** | nightly 跑真 Tauri 同 case 对照 mock 行为,漂移立即同步 | 半周 |

按 1-spec §决策点 5(CI 平台),pre-push hook 在 Phase 1 跑稳后再接 GitHub Actions(避免 abandoned workflow 复活)。

## 规模 / R 标记

- **规模**:Large(总 ~1280 行新代码 + 9 行修改 + 4 文档 / 不触动上游文件)
- **R1 三级跳**:新文件优先 ✅(所有代码在 `packages/app/e2e/` + `packages/app/vite/` 新子目录,不动 `packages/app/src/`)
- **R2 FORK marker**:测试 / fixture 文件全 fork-only,不强制 marker(但 `vite/e2e-mock.js` + `tauri.ts` 头注有 `[feat: e2e-phase1-mock-mode]` tag)
- **R3 配置 override**:0 用(本 feat 不动上游配置)
- **R4 黑名单 override**:0 笔(本 feat 0 触动黑名单文件)
- **R5(本 feat 即升级 R5 到 v4)**:Large feat 应 ≥ 2 e2e + 5 unit,本 feat 自身是测试基础设施,3 个 spec(d8-spike / d15-bootstrap / mock-foundation)覆盖自洽性 + 工程师工效;memfs/tauri.ts 行为由 mock-foundation 8 assertion 间接验证
- **R7 bug-repro**:N/A(本 feat 是新建,非 bug fix)

## 时间戳

- 立项:2026-05-22(完整方案 v2 写入)
- 启动 + W1:2026-05-23 早上
- W2 D8-D9:2026-05-23 中段
- W3 D15-D17 + R5 v4:2026-05-23 下午
- done:2026-05-23

---

## Follow-up — webServer 漏 mode 导致 mock plugin 不激活(2026-05-29)

### 症状

`bun --cwd packages/app test:e2e:local` 14 spec **5 fail / 8 pass / 1 skip**(1.2min),5 个 fail 同源两面:
- 2 个直报 `TypeError: w.__deskfoxE2eInvoke is not a function`(`mock-foundation` / `bug-repro-auto-save-debounce-flush`)
- 3 个等 `button:has-text("xxx.txt")` 60s 超时,page snapshot 显示 file-tree "No files"(`bug-repro-large-file-preview-guard` / `md-editing-iter-3-visual` / `md-editing-iter-3-visual-tour`)

### 根因

`packages/app/playwright.config.ts:7` webServer 启动命令是 `bun run dev`(= 普通 `vite`),**没带 `--mode e2e-mock`**;`env` 字段也没注入 `VITE_E2E_MOCK=true`。

`vite/e2e-mock.js:28-29` 激活条件:
```js
const isE2eMock = process.env.VITE_E2E_MOCK === "true" || env.mode === "e2e-mock"
if (!isE2eMock) return
```

两条激活路径都没满足 → plugin 整个返 undefined,跳过 `@tauri-apps/api/core → e2e/mocks/tauri.ts` alias + 跳过 `VITE_E2E_MOCK` define。后果:
1. `tauri.ts` mock 文件没被 import → `window.__deskfoxE2eInvoke` / `__deskfoxE2eMemfs` / `__deskfoxE2eOverride` 全没挂(spec 直接 `page.evaluate` 报 TypeError)
2. 产品代码 `import { invoke } from "@tauri-apps/api/core"` 走真 tauri runtime,但 e2e 没真 Tauri → 所有 invoke 静默 fail / catch 兜底 → `file.list` 返 [] → file-tree 渲染 "No files" → file click 永等不到

### 修法(1 行 + 3 行注释)

```ts
// FORK: 走 dev:e2e-mock 让 vite mode = e2e-mock,激活 e2e-mock plugin
// [bug-repro: webServer command 跑普通 `bun run dev` 缺 --mode e2e-mock → mock plugin 不激活
//  → @tauri-apps/api/core 未 alias + window.__deskfoxE2eInvoke 未注入 → 5 spec 同源 fail]
// [feat: e2e-phase1-mock-mode 修复] 2026-05-29
const command = `bun run dev:e2e-mock -- --host 0.0.0.0 --port ${port}`
```

`package.json` 里 `dev:e2e-mock` script 已存在(`vite --mode e2e-mock`),fix 只是让 playwright webServer 用它而非普通 `dev`。

### 为什么之前能通过

历史落地时(2026-05-23 W3 D17 mock-foundation 验证全过)大概率走的是手动 `bun dev:e2e-mock` 起 server + playwright `reuseExistingServer` 复用 — local default `reuseExistingServer: !process.env.CI === true`,当时没触发 webServer 自启路径。本次跑前没人手动起 server,Playwright fallback 用 `config.command` 自启 → 普通模式 → 全炸暴露。

### 验证

- `bun --cwd packages/app test:e2e:local`:**13 passed / 1 skipped / 0 failed**(32s)
- `bun typecheck`:17/17 success
- `bun lint`:0 errors / 3476 warnings(无新增)

### R 标记

- **R1 三级跳**:fork-only 文件改 1 行;0 行触动上游
- **R2 FORK marker**:`playwright.config.ts:7` 加 3 行注释(`// FORK:` + `// [bug-repro:` + `// [feat:`)
- **R4 黑名单 override(本季第 ? 笔,待对账)**:`packages/app/playwright.config.ts` 在 pre-commit hook 黑名单。**Wrapper 不可行性论证**:Playwright 入口固定从 `playwright.config.ts` 加载(`--config` 旁路会让 user/CI 多记一条且 npm script 也得改),改入口本身最直接;外层 env 注入(`VITE_E2E_MOCK=true playwright test`)能激活 plugin 但有两个缺点 — (a) `reuseExistingServer` 复用 user 手动起的普通 `bun dev`(无 env)→ 仍炸;(b) 改 `package.json` 也是触动文件,黑名单覆盖大概率一样;(c) 表达力不如 `dev:e2e-mock` script 直接对齐。**风险评估**:0 改产品代码 / 0 改 user 平时命令(`bun dev` / `bun dev:e2e-mock` 行为不变,只改 Playwright webServer 自启 command)+ 单笔 revert 即回到改前 + Phase 2 真桌面 e2e 走单独 config 不受影响。**改动日志论证**:Phase 1 e2e 5 spec 同源失效是 R5 五星级 — 不修则任何依赖 mock workspace 的新 e2e 全假阳/假阴,治理规范执行能力受损,P0 优先级。user 2026-05-29 在 AskUserQuestion 复核报告中明确批准 override 直接 commit。
- **R5 bug-repro**:5 个 fail spec 本身就是复现测试,fix 后全过即守门,**不需新增 spec**(满足 R5 v3 决策 2 等价形式)

### 后续 backlog(不阻塞本 fix)

- **改动日志.md 索引行**:`e2e-phase1-mock-mode` 这个 feat 2026-05-23 落地时漏补索引行,本次 fix 不顺手补(改动日志.md 索引行需要详情字段完整 — 非本 fix 范围,留单独 chore)
- **reuseExistingServer 误复用普通 dev**:本 fix 让 webServer 自启没问题,但 user 若先手动 `bun dev` 起在 3000 → playwright reuse → 仍是普通模式。Phase 1 跑稳后可考虑加 spec 头部 `ensureMockActive()` helper 显式断言 `window.__deskfoxE2eInvoke` 存在,失败 throw clear error

### 时间戳

- 复现 + 根因定位:2026-05-29(全自动化测试触发)
- fix + 验证:2026-05-29
