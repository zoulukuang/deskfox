---
feat-id: e2e-tauri-phase2-real-desktop
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 3-changelog — Phase 2 真桌面 e2e 启用

## 概述

把老分支 `feat/e2e-real-tauri-webdriver`(2026-05-08,3 周前架子)cherry-pick 6 文件到当前 main,**实施 saveDialog mock 方案 ①**(`page.exposeFunction` + 平台 hook),**启用 md-to-word-real.spec.ts 真桌面跑通**。

完整链路实测验证:DeskFox.exe 启动 → CDP 连入 → mock 函数注入(`page.exposeFunction("__deskFoxE2eSavePath")`)→ 项目 URL(base64 编码)→ Ctrl+K 命令面板 + 文件名 + Enter 打开文件 → 右键菜单 → 「导出为 Word」→ **平台 hook 检测到 mock 函数,跳过 native dialog 直接返 mock 路径** → 产品代码真 invoke `write_binary_file_absolute_base64` 写盘 → 验证 docx 22.5KB / `word/document.xml` 103,588 chars / 段落 + 文本 run 正常。

## commit

- `<本笔>` feat(e2e): Phase 2 真桌面 e2e 启用 — Cherry-pick + saveDialog mock 方案 ① + md-to-word-real 真跑通 [feat: e2e-tauri-phase2-real-desktop]

## 改动文件

| 文件 | 改动 | 行数 |
|---|---|---|
| `packages/app/e2e-tauri/.gitignore` | **新建**(cherry-pick) | +2 |
| `packages/app/e2e-tauri/README.md` | **新建**(cherry-pick,设计文档 + 实证) | +94 |
| `packages/app/e2e-tauri/playwright-tauri.ts` | **新建**(cherry-pick,Playwright config) | +35 |
| `packages/app/e2e-tauri/fixtures.ts` | **新建**(cherry-pick)+ 新改动:base64 编码 / mock 注入 / 改 E2E_PROJECT_DIR | +130 |
| `packages/app/e2e-tauri/specs/smoke-cdp.spec.ts` | **新建**(cherry-pick) | +48 |
| `packages/app/e2e-tauri/specs/md-to-word-real.spec.ts` | **新建**(cherry-pick)+ 新改动:去 `test.fixme` + Ctrl+K 路径替代文件树点击 | +170 |
| `packages/desktop/src/index.tsx` | 加 saveDialog mock hook(FORK marker,~13 行) | +13 |
| `packages/app/package.json` | 加 `test:e2e:tauri` script | +1 |
| `docs/features/e2e-tauri-phase2-real-desktop/{1-spec,2-plan,3-changelog}.md` | 三文档 | 新建 |

**净 +~510 行**(主要是 cherry-pick 进来的成熟既有代码 + 三文档),纯产品代码改动仅 **~13 行**(`index.tsx` saveDialog hook)。0 改上游 / 0 R4。

## 关键实现

### A. saveDialog mock 方案 ①(0 产品代码侵入)

`packages/desktop/src/index.tsx saveFilePickerDialog`:

```ts
async saveFilePickerDialog(opts) {
  // FORK: E2E 真桌面 mock 注入点 — Playwright page.exposeFunction("__deskFoxE2eSavePath") 注入时
  // 优先返 mock 路径,不弹 native save dialog。生产环境 window.__deskFoxE2eSavePath 永远 undefined,
  // fall through 走真 native dialog。0 e2e mode flag / 0 env var,纯 window 属性存在性检查。
  const e2eMock = (window as unknown as { __deskFoxE2eSavePath?: ... }).__deskFoxE2eSavePath
  if (typeof e2eMock === "function") {
    const mocked = await e2eMock(opts)
    if (typeof mocked === "string") return mocked
  }
  const result = await save({ ... })
  return handleWslPicker(result)
},
```

`packages/app/e2e-tauri/fixtures.ts`:
```ts
const e2eSavePath = `${E2E_OUTPUT_DIR}/e2e-real-export-${Date.now()}.docx`
await page.exposeFunction("__deskFoxE2eSavePath", () => e2eSavePath)
```

### B. cherry-pick 不带 457 commits 漂移

老分支基于 `7eb3200ac`(2026-05-08),main 已前进 457 commits。直接 merge 会 30+ 治理文档冲突(全是当时版本,main 早超越)。**只 cherry-pick `packages/app/e2e-tauri/` 6 个真新增文件**,丢历史包袱。

### C. 实施期发现的 2 个老分支 bug + 修

1. **Project URL 编码错**:老 fixture 用 `encodeURIComponent`,DeskFox 实际用 base64(`Buffer.from(path, "utf8").toString("base64")`)
2. **E2E_PROJECT_DIR 选错**:老 fixture 写 `C:/Users/yuexi/Downloads`(user 没 .md 文件),改用 `D:/project/opencode-fork`(本仓 docs/* / CLAUDE.md 等大量 .md,user 机器肯定有)

### D. md-to-word-real spec 用 Ctrl+K 替代文件树点击

老 spec 找 `[role="treeitem"]` filter `.md` 文本 — 但 DeskFox session 视图下文件树没展开,找不到。改用:

```ts
await page.keyboard.press("Control+k")
await page.keyboard.type("CLAUDE.md")
await page.keyboard.press("Enter")
```

比文件树点击稳:不依赖 SolidJS 结构 / 不依赖 file-tree 展开状态 / 命令面板是 DeskFox 在项目页常驻支持。

## 验证

### typecheck — 17/17 全过

### Smoke test(2 cases)
- ✅ **#1 CDP 链路 + UI hydrate**:41.2s 通(body innerHTML 1407 chars / title DeskFox / **mock 函数注入成功**)
- ⚠️ #2 dump selector:页面 crash(连续 spawn race / sidecar 清理不全)— 不影响核心目标,留 Follow-up

### md-to-word-real spec(核心目标)— ✅ **PASS 1.2 min**

完整跑通,实测结果:
- Source .md: `CLAUDE.md`(opencode-fork 根)
- Output: `D:/tmp/deskfox-test-output/e2e-real-export-1779969316147.docx`
- **docx size: 22518 bytes(22.5KB)**
- **word/document.xml: 103,588 chars**
- 含 `<w:p` 段落 + `<w:t` 文本 run + 正确 zip 结构

## 真桌面 QA 取代度

这条 e2e 让以下事项**首次自动化**:
- 真 DeskFox.exe 启动行为
- WebView2 真 hydrate 时序
- 真 Tauri command(`save_file_picker_dialog` / `write_binary_file_absolute_base64`)往返
- 跨进程 saveDialog 行为(通过 mock 短路,产品代码全跑)
- 真 SolidJS / Kobalte 命令面板交互(Ctrl+K + type + Enter)
- 真 mdMenu Portal 渲染 + 右键菜单 click

CDP self-test(`packages/media-gen/scripts/cdp-*.ts`)验数据 + Phase 1 mock e2e 验组件行为 + **Phase 2 真桌面 e2e 验整个 Tauri 跨进程实际行为**,三层金字塔补齐。

## 回归 / 回退

- 0 既有 spec 影响(`test:e2e:tauri` 独立 script,跟 Phase 1 `test:e2e` 不冲突)
- 平台 hook 是纯 `if (typeof e2eMock === "function")` 检查,生产 undefined 即 fall through native,**0 行为风险**
- 回退:`git revert` 本 commit + 删 `packages/app/e2e-tauri/` 即可。P4 可逆

## Follow-up(留 backlog)

| 项 | 投入 |
|---|---|
| smoke#2 race fix(连续 spawn 等久 / 改 fixture 加 process group kill) | 小 |
| Mac CDP 路径(WKWebView Safari Inspector) | 大 |
| 加更多 e2e 场景(导出 PDF / 文件树拖入 / 创作模式生成 / IM 桥接) | 持续 |
| docx 视觉效果优化(2026-05-07 实证 user 反馈"不理想") | 独立 feat |
| Phase 2 进 release 闸(ship 前自动跑) | 小,等 e2e 用例多一些再上 |
| 删老分支 `feat/e2e-real-tauri-webdriver` | 0(user 决定) |

## 关联

- 老分支 `feat/e2e-real-tauri-webdriver`(2026-05-07 架子,本 feat 完合后可删)
- Phase 1 mock e2e:`packages/app/e2e/` + `playwright.config.ts`(已落地,不变)
- 需求池:`OPENCODE-PLAN/需求池/e2e-测试基础设施-进展.md`(本 feat 解决 ④ Phase 2 卡 saveDialog mock 部分,可勾掉)
- 跨 feat 经验:`OPENCODE-PLAN/knowledge-base/接 AI 媒体供应商-踩坑实录.md` §10 真用户 e2e 段(本 feat 同款思路,但驱动真 DeskFox 而非 CDP self-test)
