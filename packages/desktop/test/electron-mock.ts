// [fork-only] bun:test 全局 electron mock —— 由 bunfig.toml 的 [test].preload 在所有 desktop 测试前加载。
//   [feat: electron-replatform-macos] 2026-06-14
//
// 为什么需要全局 preload(而非每个测试文件各自 mock.module):
//   多个被测源文件顶层 `import ... from "electron"`(local-asset→protocol、prevent-sleep→
//   powerSaveBlocker/BrowserWindow、store→default.app)。bun:test 同进程跑全量时,ESM linker 用
//   【最先加载 electron 的文件】固化其导出名集合;之后文件再 mock.module 也无法新增名字 →
//   缺名的 named/default import 直接 link 失败(与文件执行顺序强耦合 → 单独跑各自绿、合跑炸)。
//   preload 在任何测试文件体执行前先把 electron 定死成下面的超集 → 对任意执行顺序鲁棒。
//
// 维护:当新增测试会加载到【顶层 import 了 electron 新成员】的源文件时,把该成员补进下面对象。
import { mock } from "bun:test"

const electronMock: Record<string, unknown> = {
  protocol: { handle: () => {} },
  powerSaveBlocker: { start: () => 1, stop: () => {}, isStarted: () => false },
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: () => "/tmp/deskfox-test" },
}
// store.ts 用 `import electron from "electron"`(default 形态)→ default 自指,同时满足 default + named import。
electronMock.default = electronMock

mock.module("electron", () => electronMock)
