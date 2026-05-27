// [fork-only] 插件入口 export 面守卫
// [bug-repro: feishu 插件 export 了 migrateLegacyWorkspace/applyStaleSessionsCleanup 两个裸 helper,
//  opencode plugin loader 的 getLegacyPlugins 遍历模块所有 export 当 plugin server 调
//  fn(input, options) → 第 3 参 fs=undefined → fs.existsSync 抛 "failed to load plugin"]
//
// 修法:helper 挪到 ./workspace-migrate,plugin.ts import 使用、不 re-export。
// 本测试守住:插件入口只 export 真插件(default/server),绝不 export 裸工具函数。
import { describe, expect, test } from "bun:test"
import * as pluginModule from "../plugin"

describe("plugin 入口 export 面", () => {
  test("不 export 裸 helper(否则被 opencode getLegacyPlugins 误当插件调 → fs undefined 崩)", () => {
    expect(pluginModule).not.toHaveProperty("migrateLegacyWorkspace")
    expect(pluginModule).not.toHaveProperty("applyStaleSessionsCleanup")
  })

  test("真正的插件 export 在(default + server 都是函数)", () => {
    expect(typeof pluginModule.default).toBe("function")
    expect(typeof (pluginModule as { server?: unknown }).server).toBe("function")
  })

  test("所有函数 export 都是同一个插件函数引用(无裸工具函数泄漏)", () => {
    // opencode getLegacyPlugins 遍历所有 export、按 value 去重当 plugin server 调。
    // default/server/FeishuBridgePlugin 都指向同一函数 → 去重后 1 个插件,OK;
    // 若泄漏 migrate/cleanup 等裸 helper(不同函数引用)→ uniqueFns > 1,本断言失败。
    const fnValues = Object.values(pluginModule as Record<string, unknown>).filter((v) => typeof v === "function")
    expect(fnValues.length).toBeGreaterThan(0)
    expect(new Set(fnValues).size).toBe(1)
  })
})
