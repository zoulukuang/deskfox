// FORK-ONLY: 品牌替换层单测 + i18n 出口「无 OpenCode 回潮」断言 [feat: electron-brand-cleanup]
//
// 覆盖:① rebrandValue/isRebrandExemptKey/rebrandDict 替换+白名单逻辑;
//       ② app 出口(appEn+uiEn)经 rebrandDict 后,除白名单外不得再暴露 "OpenCode"(回潮断言)。
// desktop 出口(appEn+desktopEn)的同款回潮断言放在 desktop 包侧
//   (packages/desktop/src/renderer/i18n/rebrand-regression.test.ts)—— app 的 tsconfig 不含 desktop 文件,
//   跨包 import 会触发 tsgo 项目边界报错(TS6307);desktop 引用 app 则合法,故按引用方向就近放置。

import { describe, expect, test } from "bun:test"
import { isRebrandExemptKey, rebrandDict, rebrandValue } from "./rebrand"
import { dict as appEn } from "./en"
import { dict as uiEn } from "@opencode-ai/ui/i18n/en"

describe("rebrandValue", () => {
  test("替换裸 OpenCode → DeskFox", () => {
    expect(rebrandValue("Welcome to OpenCode")).toBe("Welcome to DeskFox")
    expect(rebrandValue("OpenCode server")).toBe("DeskFox server")
  })

  test("OpenCode Desktop 收敛为 DeskFox(无 Desktop 后缀)", () => {
    expect(rebrandValue("OpenCode Desktop")).toBe("DeskFox")
  })

  test("保留官方专名 OpenCode Zen / OpenCode Go", () => {
    expect(rebrandValue("Use OpenCode Zen models")).toBe("Use OpenCode Zen models")
    expect(rebrandValue("Subscribe to OpenCode Go today")).toBe("Subscribe to OpenCode Go today")
  })

  test("同句混合:裸 OpenCode 替换、Zen/Go 保留", () => {
    expect(rebrandValue("OpenCode includes OpenCode Zen and OpenCode Go")).toBe(
      "DeskFox includes OpenCode Zen and OpenCode Go",
    )
  })

  test("非字符串原样返回", () => {
    // @ts-expect-error 故意传非字符串
    expect(rebrandValue(undefined)).toBeUndefined()
  })
})

describe("isRebrandExemptKey", () => {
  test("wsl 命名空间(顶层与嵌套)豁免", () => {
    expect(isRebrandExemptKey("wsl.onboarding.step.opencode")).toBe(true)
    expect(isRebrandExemptKey("settings.desktop.wsl.description")).toBe(true)
  })

  test("MCP 报错 + freeModels 归属豁免", () => {
    expect(isRebrandExemptKey("error.chain.mcpFailed")).toBe(true)
    expect(isRebrandExemptKey("dialog.model.unpaid.freeModels.title")).toBe(true)
  })

  test("普通 key 不豁免", () => {
    expect(isRebrandExemptKey("dialog.server.description")).toBe(false)
    expect(isRebrandExemptKey("app.name.desktop")).toBe(false)
  })
})

describe("rebrandDict 按 key 豁免", () => {
  test("豁免 key 的 value 原样保留,其余替换", () => {
    const out = rebrandDict({
      "dialog.server.description": "Switch which OpenCode server this app connects to.",
      "error.chain.mcpFailed": "OpenCode does not support MCP authentication yet.",
      "settings.desktop.wsl.description": "Run the OpenCode server inside WSL on Windows.",
      "dialog.model.unpaid.freeModels.title": "Free models provided by OpenCode",
    })
    expect(out["dialog.server.description"]).toBe("Switch which DeskFox server this app connects to.")
    expect(out["error.chain.mcpFailed"]).toBe("OpenCode does not support MCP authentication yet.")
    expect(out["settings.desktop.wsl.description"]).toBe("Run the OpenCode server inside WSL on Windows.")
    expect(out["dialog.model.unpaid.freeModels.title"]).toBe("Free models provided by OpenCode")
  })
})

/**
 * 回潮断言:对真实字典做 rebrandDict 后,逐条 value 不得残留 "OpenCode" ——
 * 除非该 key 命中白名单,或残留仅为官方专名 "OpenCode Zen" / "OpenCode Go"。
 */
function assertNoBrandRegression(label: string, dict: Record<string, string>) {
  const rebranded = rebrandDict(dict)
  const offenders: string[] = []
  for (const key in rebranded) {
    if (isRebrandExemptKey(key)) continue
    const stripped = rebranded[key].replace(/OpenCode Zen/g, "").replace(/OpenCode Go/g, "")
    if (stripped.includes("OpenCode")) offenders.push(`${key} = ${rebranded[key]}`)
  }
  expect(offenders, `${label} 出口残留 OpenCode(非白名单):\n${offenders.join("\n")}`).toEqual([])
}

describe("i18n 出口无 OpenCode 回潮", () => {
  test("app 出口(appEn + uiEn)", () => {
    assertNoBrandRegression("app", { ...appEn, ...uiEn })
  })
})
