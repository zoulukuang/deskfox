// FORK-ONLY: desktop renderer i18n 出口「无 OpenCode 回潮」断言 [feat: electron-brand-cleanup]
//
// desktop renderer 是独立于 app 的第 2 套 i18n 出口(index.ts flatten { ...appEn, ...desktopEn } 后套 rebrandDict)。
// 本测验证该出口经 rebrandDict 后,除白名单外不再暴露 "OpenCode" —— 尤其 desktopEn 自带的
// desktop.updater.* 升级 toast(B3)必须被替换成 DeskFox。
// 放在 desktop 包侧:desktop 的 tsconfig 引用 app(可合法 import app/src/i18n/rebrand),反向不成立。

import { describe, expect, test } from "bun:test"
import { isRebrandExemptKey, rebrandDict } from "../../../../app/src/i18n/rebrand"
import { dict as appEn } from "../../../../app/src/i18n/en"
import { dict as desktopEn } from "./en"

/**
 * 对真实字典做 rebrandDict 后,逐条 value 不得残留 "OpenCode" ——
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

describe("desktop renderer i18n 出口无 OpenCode 回潮", () => {
  test("desktop 出口(appEn + desktopEn)", () => {
    assertNoBrandRegression("desktop", { ...appEn, ...desktopEn })
  })

  test("desktopEn 自带的升级 toast(B3)被替换为 DeskFox", () => {
    const out = rebrandDict({ ...desktopEn } as Record<string, string>)
    expect(out["desktop.updater.none.message"]).toBe("You are already using the latest version of DeskFox")
    expect(out["desktop.updater.downloaded.prompt"]).toContain("DeskFox")
    expect(out["desktop.updater.downloaded.prompt"]).not.toContain("OpenCode")
  })
})
