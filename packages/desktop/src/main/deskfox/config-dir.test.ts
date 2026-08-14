// [fork-only] local 档配置隔离 —— 目录解析单测 [feat: local-config-isolation] 2026-08-12
//
// [bug-repro: ① plugin-install 硬编码 ~/.config/opencode,而 sidecar 读 $XDG_CONFIG_HOME/opencode,
//   两者不是同一个文件 → 独占接管/自愈机制长期失效(2026-08-12 实测两份文件内容不同);
//   ② local 档与发布渠道共享同一份 config,与「local 与正式版互不打扰」的承诺不符]
import { test, expect, describe } from "bun:test"
import { configDirName, needsConfigDirEnv, RELEASE_CONFIG_DIR_NAME } from "./config-dir"

describe("configDirName", () => {
  test("发布渠道用默认目录 opencode(与 sidecar 默认位置一致,不需要额外注入)", () => {
    for (const ch of ["prod", "dev", "beta"]) {
      expect(configDirName(ch, true)).toBe("opencode")
      expect(needsConfigDirEnv(ch, true)).toBe(false)
    }
  })

  test("local 档用独立目录 opencode-local", () => {
    expect(configDirName("local", true)).toBe("opencode-local")
    expect(needsConfigDirEnv("local", true)).toBe(true)
  })

  test("未打包(开发态)按 local 处理 —— 与 DB 分流规则一致", () => {
    expect(configDirName("prod", false)).toBe("opencode-local")
    expect(needsConfigDirEnv("prod", false)).toBe(true)
  })

  test("命名与 DB 的 opencode-local.db 对齐,一眼能看出归属", () => {
    expect(configDirName("local", true)).toBe("opencode-local")
    expect(RELEASE_CONFIG_DIR_NAME).toBe("opencode")
  })

  test("发布渠道之间不互相隔离(prod/dev/beta 共享,对齐既有 DB 行为)", () => {
    const names = ["prod", "dev", "beta"].map((c) => configDirName(c, true))
    expect(new Set(names).size).toBe(1)
  })
})
