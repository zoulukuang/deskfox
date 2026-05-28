---
feat-id: e2e-tauri-phase2-real-desktop
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 2-plan — 实施步骤 + 决策轨迹

## Stage A — 平台 hook + fixture 注入(saveDialog mock 方案 ①)

1. `packages/desktop/src/index.tsx saveFilePickerDialog` 加 hook(FORK marker,~6 行)
2. `packages/app/e2e-tauri/fixtures.ts` 修改:
   - 在 `page.goto(projectUrl)` **之前**调 `page.exposeFunction("__deskFoxE2eSavePath", () => e2eSavePath)`
   - 之前的占位 `e2eSavePath` 改为真用(测试结束后保留文件用于 docx 验证)
   - 输出目录 `D:/tmp/deskfox-test-output/` `mkdirSync` recursive

## Stage B — 启用 md-to-word-real spec

- 去掉 `test.fixme` → 改回 `test(...)` 让 Playwright 真跑
- selector 兼容性:`[data-context="file-viewer"]` + `[data-slot="md-selection-menu"]` 在 457 commits 之后是否仍然存在?用 grep 快速核 + 必要时 fixture probe 兜底

## Stage C — package.json script

`packages/app/package.json` 加:
```json
"test:e2e:tauri": "playwright test --config=e2e-tauri/playwright-tauri.ts"
```

注:Playwright `--config=` 接任意 ts 文件,不强制 `.config.ts` 命名(老分支 README 已说明,是 pre-commit hook 黑名单规避)。

## Stage D — 验证

1. `build-deskfox.ps1 -Env dev -NoBundle` 出新 exe(含平台 hook)
2. **smoke 先跑**:`bun run --cwd packages/app test:e2e:tauri -- specs/smoke-cdp.spec.ts`
   - 验 CDP 连得上 + body innerHTML > 1k + 控制台 DOM 探查
   - 若 selector 漂移,先调整 smoke 让它绿
3. **md-to-word-real 跑**:`bun run --cwd packages/app test:e2e:tauri -- specs/md-to-word-real.spec.ts`
   - 验 docx 落盘 + word/document.xml 存在 + 段落 run 正常
   - 若 selector 失败:probe DOM(spec 内置 dump 兜底)拿到真实 selector + 改 spec

## 决策轨迹

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 直接 merge 老分支 vs cherry-pick 6 文件 | **cherry-pick**(老分支 457 commits 漂移,30+ 治理文档冲突极难) |
| 2 | saveDialog mock 3 候选选哪个 | **方案 ①** `page.exposeFunction`(0 侵入,6 行平台 hook,生产 fall-through) |
| 3 | mock 函数名 | `__deskFoxE2eSavePath`(camelCase + `__` 前缀避撞)|
| 4 | Phase 2 是否进 pre-push 闸 | **不进**(build release + 跑 2-3 分钟太重;独立 `bun test:e2e:tauri` 手动 / 后续 CI 闸) |
| 5 | 测试 selector 漂移怎么办 | Smoke 先验,失败优先调 smoke 拿真 DOM 探查信号,再调业务 spec |

## 风险

- **selector 漂移**:457 commits 期间 `[data-context="file-viewer"]` / `[data-slot="md-selection-menu"]` 可能改名/删除。缓解:smoke 先跑确诊,业务 spec 内置 dump 模式兜底
- **headless 不可行**:Tauri WebView2 不支持 headless,测试窗口必弹出(fixture SetForegroundWindow 让 user 看见,不影响正确性)
- **测试间端口残留**:DeskFox 起 :9222,若上次测试未清干净,本次 spawn 会撞端口。fixture teardown SIGKILL + 500ms 等让 Win 释放 — 已经做了

## 测试计划

R5 Medium ≥1 e2e 已天然满足(本 feat 本身就是加 e2e)。
- smoke-cdp:2 cases(已存在)
- md-to-word-real:1 case(去 fixme 后启用)
- 总 3 e2e cases,远超 ≥1 要求
- 单测:无新增(本 feat 是 e2e 基础设施层)
