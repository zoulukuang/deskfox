# Manual app performance suite

<!-- FORK: DeskFox 侧的归属已钉死 —— 这一组**进发版验收清单、不进 pre-push**。
     **一定要走 `bun run test:bench`**:裸跑 `playwright test --config e2e/performance/playwright.config.ts`
     会把 `timeline-stability/fixture.test.ts`(bun 单测)也收进来 → Node ESM loader 抛
     `Received protocol 'bun:'`,一条用例都跑不起来;过滤 `"\.spec\.ts$"` 挂在 test:bench 脚本上。
     跑法契约与另外两个坑(e2e 布局基线是经典布局且 URL 形状要跟着换 / 放宽视觉不变量必须先探针实测)
     见 `docs/governance/自动化测试规范.md` §performance 组的归属。
     2026-08-18 [feat: voice-preclear-batch] -->

<!-- FORK: Windows 侧跑法(2026-08-18 Win 端回验实测,第三个坑)——
     `timeline/session-timeline-benchmark.spec.ts` 那 4 条 streaming 用例在 Win 上按默认参数
     **必然超时红**:默认 `TIMELINE_CPU_THROTTLE=30` + `TIMELINE_COMPLETION_TIMEOUT_MS=420000`
     是按 mac 单核性能定的绝对阈值,同样 160 个 delta 在本机 30x 节流下跑不进 7 分钟。
     **这不是回归**:降到 `TIMELINE_CPU_THROTTLE=6` 后 4 条全过,且指标显示逻辑完全正常
     (`maxObservedProgressIndex=160`、`pendingDeltas=0`、完成耗时 77-91s)。
     基准阈值**不要为了让 Win 变绿去改**——固定阈值正是这组的价值所在;Win 侧复跑用:
       TIMELINE_CPU_THROTTLE=6 bunx playwright test --config e2e/performance/playwright.config.ts          e2e/performance/timeline/session-timeline-benchmark.spec.ts
     另记:整套在 Win 上约 34 分钟,mac 约 10 分钟,判断"卡住了没"时按这个量级预期。
     2026-08-18 [feat: voice-preclear-batch] -->

The app's high-volume performance diagnostics live under `packages/app/e2e/performance` and are excluded from normal local and CI Playwright discovery. The benchmark config builds the app and serves the production bundle before running scenarios serially.

Run the suite explicitly from `packages/app`:

```sh
bun run test:bench
```

PowerShell:

```powershell
$env:PLAYWRIGHT_WORKERS = "1"
bun run test:bench
```

The suite contains:

- cold and hot session-tab timing
- home-session click timing split between content and titlebar-tab paint
- single-session tab close timing through stable home restoration
- cached session repaint and mutation tracing
- streaming timeline throughput, RAF-gap, long-task, geometry, and remount diagnostics

All benchmarks import the shared `benchmark` fixture. Pages created through Playwright's `page` fixture automatically capture main-frame navigation history and emit a Chrome trace when `OPENCODE_PERFORMANCE_TRACE_DIR` is set. Benchmarks that need isolated browser contexts use `withBenchmarkPage`, which owns the context and the same diagnostics lifecycle.

New benchmarks should look like normal Playwright tests:

```ts
import { benchmark, expect } from "../benchmark"

benchmark("measures one interaction", async ({ page, report }) => {
  // Only scenario-specific setup and interaction belong here.
  report({ durationMs: 42 })
})
```

The fixture requires every benchmark to call `report()`, automatically names and closes traces, captures navigation history, attaches that history when a test fails, and emits metrics as a consistent `BENCHMARK` JSON line.

```text
BENCHMARK {"name":"...","context":{"project":"chromium","platform":"darwin"},"metrics":{...}}
```

Every observed page also emits `BENCHMARK_PAGE` with the same run ID, navigation history, and optional trace path before the final status-bearing `BENCHMARK` record. Chrome traces are browser-wide page-lifetime diagnostics; scenario metrics use narrower explicitly named observation windows.

This follows the stack's own guidance: [Electron recommends repeated Chrome DevTools and Chrome Tracing measurement](https://www.electronjs.org/docs/latest/tutorial/performance), [Chrome DevTools recommends Performance recordings for runtime work](https://developer.chrome.com/docs/devtools/performance), and [Playwright uses traces for test debugging rather than renderer profiling](https://playwright.dev/docs/trace-viewer).

These Playwright benchmarks profile the shared app renderer in Chromium. A future packaged Electron benchmark that needs main-process and multi-process attribution should use Electron's official [`contentTracing`](https://www.electronjs.org/docs/latest/api/content-tracing/) API rather than extending this renderer harness with bespoke process instrumentation.

CPU and high-volume visual profiling are disabled by default. Set `TIMELINE_CPU_PROFILE=1` to enable both, or additionally set `TIMELINE_VISUAL_PROFILE=0` for CPU-only profiling.

The streaming scenario's 30x CPU throttle is a deterministic stress profile, not a simulated end-user device.

Benchmarks do not assert machine-dependent performance budgets. Streaming processes 160 deltas by default and reports renderer-observed completion time, throughput, RAF callback-gap distributions, frame-budget equivalents, and long tasks through final geometry settlement. Delta count and delivery batch are included in result context when overridden. These are main-thread callback diagnostics, not compositor presentation or dropped-frame measurements. Visual-only and geometry metrics are `null` when their probes are disabled. Tab metrics describe sampled DOM observations. Assertions verify scenario and metric collection completion. Repeated repaint states are run-length grouped, but every original observation timestamp is retained alongside raw mutation batches and layout shifts.

Committed smoke and regression tests continue to own correctness coverage for pagination, tab paint, context resize, collapse state, and composer spacing.

## Chrome traces

Set `OPENCODE_PERFORMANCE_TRACE_DIR` to emit a standard Chrome DevTools trace for every benchmark page automatically:

```sh
OPENCODE_PERFORMANCE_TRACE_DIR=/tmp/opencode-performance-traces \
bunx playwright test --config e2e/performance/playwright.config.ts \
  timeline/session-tab-switch-benchmark.spec.ts
```

The emitted JSON is a standard Chrome trace and can be loaded directly into the Chrome DevTools Performance panel. `devtools-tracing` can optionally inspect it from the command line without adding package scripts or dependencies:

Trace capture mirrors [Puppeteer's official tracing defaults and lifecycle](https://pptr.dev/api/puppeteer.tracing), using Chrome's `ReturnAsStream` transfer mode and failing when Chromium reports trace data loss.

```sh
bunx devtools-tracing stats <trace-path-from-BENCHMARK_PAGE>
```

INP analysis requires a trace with a supported navigation/interaction insight. Selector statistics require a trace captured with `OPENCODE_PERFORMANCE_SELECTOR_TRACE=1`.

`e2e/performance/playwright.uncapped.config.ts` disables Chromium frame-rate limiting for explicit uncapped diagnostics. Native product benchmarks should use the default Playwright configuration.
