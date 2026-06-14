---
feat-id: e2e-tauri-phase2-real-desktop
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 1-spec — e2e Phase 2 真桌面 e2e 启用(Playwright + WebView2 CDP)

## 背景

DeskFox 测试金字塔:
- ✅ unit 单测(每包 bun test,稳定)
- ✅ Phase 1 mock e2e(Playwright + Vite mock,`packages/app/e2e/`,30+ specs)
- ⏸ **Phase 2 真桌面 e2e**(`packages/app/e2e-tauri/`,架子在老分支 `feat/e2e-real-tauri-webdriver` 2026-05-08 摆好,卡在 saveDialog mock 没启用)

Memory `feedback_cdp_selftest_complements_not_replaces_qa.md`:CDP self-test 跑 fetch body / 路由验证不替代真桌面 QA。真桌面 e2e 是验**native dialog 行为 / WebView2 真 hydrate 时序 / 真 Tauri command + Rust 后端往返**的唯一自动化路径。

## 目标

1. 从老分支 cherry-pick 6 个 `e2e-tauri/` 文件到当前 main(老分支基于 3 周前 main,带 457 commits 漂移,不能直接 merge)
2. 实施 **saveDialog mock 方案 ①**(`page.exposeFunction`,0 产品代码侵入):
   - `packages/desktop/src/index.tsx saveFilePickerDialog` 加 `window.__deskFoxE2eSavePath` 检查(生产 undefined fall through)
   - `e2e-tauri/fixtures.ts` 通过 `page.exposeFunction("__deskFoxE2eSavePath", () => savePath)` 注入
3. 启用 `md-to-word-real.spec.ts`(去掉 `test.fixme`)
4. 加 `packages/app/package.json test:e2e:tauri` script
5. **smoke-cdp + md-to-word-real 两个 spec 真桌面跑通**

## 非目标

- **不做 Mac CDP 路径**(WebKit Inspector 不同,留 backlog)
- **不接 pre-push 闸**(Phase 2 真桌面跑要 build release exe + 2-3 分钟,push 闸太重;留独立 `bun run test:e2e:tauri` 手动 / CI 触发)
- **不做 docx 视觉效果优化**(per 实证记录"user 反馈不理想",独立 backlog)
- **不删老 feat 分支**(本 feat 完合 main 后,user 决定删 `feat/e2e-real-tauri-webdriver`)

## 关键设计决策

### A. saveDialog mock 用方案 ①(`page.exposeFunction`)

老分支 README 已列 3 候选:
| 方案 | 优点 | 缺点 |
|---|---|---|
| **① `page.exposeFunction`** | 0 产品代码侵入,生产 window 字段 undefined fall through | 需 1 行 Tauri 平台代码加 hook |
| ② env var | 完全后端控制 | 需 1 行 platform + 1 个 Tauri command |
| ③ Tauri Rust mock | 最彻底 | 重工程,改 Rust 侧 |

选 ① 因投入最小、产品代码侵入小到肉眼难辨。

### B. cherry-pick 6 文件,不带其他历史包袱

老分支基于 `7eb3200ac`(2026-05-08),后续 main 跑了 457 commits。直接 merge 会触发 30+ 治理文档冲突(全是当时版本,main 早超越)。**只 cherry-pick `packages/app/e2e-tauri/` 6 个真新增文件**,不动任何其他文件,避免污染。

### C. 平台 hook 代码风格

```ts
async saveFilePickerDialog(opts) {
  // FORK: E2E mock 注入点 — Playwright page.exposeFunction 注入时优先返 mock 路径
  // 生产环境 window.__deskFoxE2eSavePath 永远 undefined,fall through 不影响真 native dialog
  const e2eMock = (window as any).__deskFoxE2eSavePath
  if (typeof e2eMock === "function") {
    const mocked = await e2eMock(opts)
    if (typeof mocked === "string") return mocked
  }
  const result = await save({ title: ..., defaultPath: ... })
  return handleWslPicker(result)
}
```

## 改动规模

**Medium**:
- cherry-pick 6 文件(`packages/app/e2e-tauri/`,~14KB 既有代码)
- 修改:`packages/desktop/src/index.tsx`(+6 行 mock hook)
- 修改:`packages/app/package.json`(+1 test 脚本)
- 修改:`packages/app/e2e-tauri/fixtures.ts`(+5 行 `page.exposeFunction`)
- 修改:`packages/app/e2e-tauri/specs/md-to-word-real.spec.ts`(去 `test.fixme`)
- 三文档:spec + plan + changelog

~净 +30 行 fork-only(+ 6 个新文件 ~14KB)。

## 验收

- [x] cherry-pick 完成,working tree 干净
- [ ] `bun run --cwd packages/app test:e2e:tauri --grep smoke` 跑通(2 个 smoke case)
- [ ] `bun run --cwd packages/app test:e2e:tauri --grep "MD → Word"` 跑通(md-to-word-real)
- [ ] 验证 docx 落盘 + word/document.xml 存在 + 段落+文本 run 正常
- [ ] 0 产品代码侵入(平台 hook 是 hard-coded property name 检查,无 e2e mode flag)
- [ ] 0 改上游 TS(`packages/desktop/src/index.tsx` 是 fork-only 包,但 hook 处加 FORK marker)

## Follow-up(留 backlog)

- Mac CDP 路径(WKWebView Safari Inspector)
- 加更多场景:导出 PDF / 文件树拖入 / 创作模式生成
- docx 视觉效果优化(独立 feat)
- 集成进 release 流程(每次 ship 前自动跑)
