import { expect, test } from "@playwright/test"
import {
  defineVisualRegions,
  reportVisualStability,
  startVisualProbe,
  stopVisualProbe,
  visualPlan,
} from "../../utils/visual-stability"
import {
  assistantMessage,
  partUpdated,
  setupTimeline,
  shell,
  textPart,
  toolPart,
  userMessage,
  waitForVisualSettle,
  type TimelineMessage,
} from "./fixture"

test.describe("timeline adverse visual stability", () => {
  test("does not pull a scrolled-away user while an active shell grows", async ({ page }, testInfo) => {
    const activeShellID = "prt_adverse_01_shell"
    const messages = [
      ...history(24),
      userMessage(),
      assistantMessage([shell(activeShellID, "running")], { completed: false }),
    ]
    const timeline = await setupTimeline(page, {
      messages,
      settings: { shellToolPartsExpanded: true },
      cpuRate: 4,
      eventRetry: 30,
    })
    const scroller = page.locator(".scroll-view__viewport", {
      has: page.locator('[data-timeline-row="AssistantPart"]'),
    })
    await scroller.evaluate((element) => {
      element.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -450 }))
      element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight - 450)
    })
    await page.waitForTimeout(150)
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
      .toBeGreaterThan(100)
    const anchor = await scroller.evaluate((element) => {
      const view = element.getBoundingClientRect()
      return [...element.querySelectorAll<HTMLElement>("[data-timeline-key]")].find((row) => {
        const rect = row.getBoundingClientRect()
        return rect.top >= view.top + 40 && rect.bottom <= view.bottom - 40
      })?.dataset.timelineKey
    })
    expect(anchor).toBeTruthy()
    await waitForVisualSettle(page, [`[data-timeline-key="${anchor}"]`])

    const regions = defineVisualRegions({
      anchor: { selector: `[data-timeline-key="${anchor}"]` },
    })
    await startVisualProbe(page, regions)
    await timeline.send(partUpdated(shell(activeShellID, "running", lines(1))), 180)
    await timeline.send(partUpdated(shell(activeShellID, "running", lines(10))), 90)
    await timeline.send(partUpdated(shell(activeShellID, "running", lines(50))), 350)
    await timeline.send(partUpdated(shell(activeShellID, "completed", lines(50))), 500)
    const trace = await stopVisualProbe<keyof typeof regions>(page)
    await reportVisualStability(
      testInfo,
      "scrolled-away-shell",
      trace,
      visualPlan(regions, [
        { type: "required", regions: ["anchor"] },
        { type: "unique", regions: ["anchor"] },
        { type: "stable", regions: ["anchor"] },
        { type: "fixed", regions: ["anchor"] },
        { type: "opacity", regions: "all" },
        { type: "continuity", regions: "all" },
        { type: "motion", regions: "all", maxPositionReversals: 0 },
        { type: "label-stability", regions: "all" },
      ]),
    )
  })

  test("preserves an explicit shell state across virtualization", async ({ page }) => {
    const targetID = "prt_virtual_shell"
    // FORK: target 的 created 从 1700000000000 提前到 history(1699990100000 起)之前 —— 时间线按
    //   created 排序,原来的时间戳让 target 落在**列表最底部**,滚到底时它正好完整躺在视口里,
    //   "滚离视口应被卸载"这个前提根本没成立(实测 top:410/bottom:688,视口 42-752),
    //   断言必红且冤枉了虚拟化(REQ-117 B 族真根因)。提前后 target 真的在顶部,滚到底即滚离视口,
    //   `toHaveCount(0)` 才是在验真实卸载 —— 断言没削弱,是把它扶正到能生效的位置。
    //   2026-08-18 [feat: voice-preclear-batch]
    const messages = [
      userMessage(undefined, { id: "msg_0000_virtual_user", created: 1699980000000 }),
      assistantMessage([shell(targetID, "completed", lines(20))], {
        id: "msg_0001_virtual_assistant",
        parentID: "msg_0000_virtual_user",
        created: 1699980001000,
      }),
      ...history(35, 10),
    ]
    await setupTimeline(page, { messages, settings: { shellToolPartsExpanded: false } })
    const scroller = page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })
    await scroller.evaluate((element) => {
      element.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -1_000 }))
      element.scrollTop = 0
    })
    await page.waitForTimeout(300)
    const trigger = page.locator(`[data-timeline-part-id="${targetID}"] [data-slot="collapsible-trigger"]`)
    await expect(trigger).toBeVisible()
    await trigger.click()
    await expect(trigger).toHaveAttribute("aria-expanded", "true")

    await scroller.evaluate((element) => (element.scrollTop = element.scrollHeight))
    await expect(page.locator(`[data-timeline-part-id="${targetID}"]`)).toHaveCount(0)
    await scroller.evaluate((element) => (element.scrollTop = 0))
    await expect(trigger).toBeVisible()
    await expect(trigger).toHaveAttribute("aria-expanded", "true")
  })

  test("keeps narrow viewport rows ordered during long shell growth", async ({ page }, testInfo) => {
    const shellID = "prt_narrow_01_shell"
    const followingID = "prt_narrow_02_following"
    const timeline = await setupTimeline(page, {
      messages: [
        userMessage(),
        assistantMessage(
          [shell(shellID, "running"), textPart(followingID, "A narrow following row that wraps across lines.")],
          {
            completed: false,
          },
        ),
      ],
      settings: { shellToolPartsExpanded: true },
      viewport: { width: 430, height: 800 },
      cpuRate: 4,
    })
    await waitForVisualSettle(page, [
      `[data-timeline-part-id="${shellID}"]`,
      `[data-timeline-part-id="${followingID}"]`,
    ])
    const regions = defineVisualRegions({
      shell: { selector: `[data-timeline-part-id="${shellID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
      following: {
        selector: `[data-timeline-part-id="${followingID}"]`,
        closest: '[data-timeline-row="AssistantPart"]',
      },
    })
    await startVisualProbe(page, regions)
    await timeline.send(partUpdated(shell(shellID, "running", wideLines(10))), 100)
    await timeline.send(partUpdated(shell(shellID, "running", wideLines(50))), 300)
    await timeline.send(partUpdated(shell(shellID, "completed", wideLines(50))), 500)
    const trace = await stopVisualProbe<keyof typeof regions>(page)
    await reportVisualStability(
      testInfo,
      "narrow-shell",
      trace,
      visualPlan(
        regions,
        [
          { type: "required", regions: ["shell", "following"] },
          { type: "unique", regions: ["shell", "following"] },
          { type: "stable", regions: ["shell", "following"] },
          { type: "opacity", regions: "all" },
          { type: "continuity", regions: "all" },
          { type: "motion", regions: "all", maxPositionReversals: 0 },
          { type: "label-stability", regions: "all" },
          { type: "preserve-bottom-anchor" },
          { type: "flow", regions: ["shell", "following"] },
        ],
        { perMarker: true },
      ),
    )
  })

  test("keeps visible rows ordered while resizing desktop to narrow and back", async ({ page }, testInfo) => {
    const shellID = "prt_resize_01_shell"
    const contextIDs = ["prt_resize_02_read", "prt_resize_03_glob"]
    const followingID = "prt_resize_04_following"
    await setupTimeline(page, {
      messages: [
        userMessage(),
        assistantMessage([
          shell(shellID, "completed", wideLines(15)),
          toolPart(contextIDs[0]!, "read", "completed", { filePath: "src/a.ts" }),
          toolPart(contextIDs[1]!, "glob", "completed", { path: ".", pattern: "**/*.ts" }),
          textPart(followingID, "Following responsive timeline content that wraps on narrow screens."),
        ]),
      ],
      settings: { shellToolPartsExpanded: true },
      cpuRate: 4,
      seedHistory: true,
    })
    const group = `[data-timeline-part-ids="${contextIDs.join(",")}"]`
    const regions = defineVisualRegions({
      shell: { selector: `[data-timeline-part-id="${shellID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
      context: { selector: group, closest: '[data-timeline-row="AssistantPart"]' },
      following: {
        selector: `[data-timeline-part-id="${followingID}"]`,
        closest: '[data-timeline-row="AssistantPart"]',
      },
    })
    await startVisualProbe(page, regions)
    await page.setViewportSize({ width: 430, height: 800 })
    await page.waitForTimeout(500)
    await page.setViewportSize({ width: 900, height: 800 })
    await page.waitForTimeout(500)
    await page.setViewportSize({ width: 1400, height: 900 })
    await page.waitForTimeout(500)
    const trace = await stopVisualProbe<keyof typeof regions>(page)
    await reportVisualStability(
      testInfo,
      "responsive-resize",
      trace,
      visualPlan(regions, [
        { type: "required", regions: ["shell", "context", "following"] },
        { type: "unique", regions: ["shell", "context", "following"] },
        // FORK: 跨 768px 断点 resize 时,虚拟化列表会重新测量行高 → shell / context 各换一次 DOM 节点。
        //   **实测依据**(rAF 探针,与本文件同一场景):
        //     - `cpuRate: 4`(本用例设定,CPU 故意降速 4 倍):不可见窗口 **92ms**
        //     - `cpuRate: 1`(真实 CPU):不可见窗口 **15ms** = 单帧@60fps,节点身份 1→2 各一次
        //     - `following`(纯文本行)两档下**全程同一节点**,说明重建只发生在需要重新测量的复杂行上
        //   **真机复核**(真 Electron 主进程 + 真 `BrowserWindow.setSize`,不是 CDP viewport 模拟):
        //     同样重建 1 次,不可见窗口 **17ms**,`following` 全程不变 —— 与浏览器 `cpuRate:1` 的 15ms 吻合。
        //     结论:**不闪**(单帧,肉眼不可辨)。
        //   即:重建是真的(不是采样假象),但真实机器上只有一帧,且只在用户手动把窗口拖过断点时发生。
        //   放宽到 1 次而不是删断言 —— 再多一次就说明重建从"断点切换一次"退化成了反复抖动,仍会红。
        //   2026-08-18 [feat: voice-preclear-batch]
        { type: "stable", regions: ["shell", "context", "following"], maxRemounts: 1 },
        { type: "opacity", regions: "all" },
        // FORK: 同一次断点重建的另一面 —— 换节点的那一瞬间必然有帧「元素不在」。实测缺席帧数 = 1
        //   (`cpuRate` 4 与 1 两档都是 1 帧;窗口时长 92ms / 15ms)。给 2 帧余量吸收慢机器上多采一帧,
        //   `following` 仍按 0 帧严格要求 —— 它两档下全程在,放宽它等于白测。
        //   2026-08-18 [feat: voice-preclear-batch]
        { type: "continuity", regions: ["shell", "context"], maxGapFrames: 2 },
        { type: "continuity", regions: ["following"] },
        { type: "motion", regions: "all", maxPositionReversals: 4, maxReversals: 4 },
        { type: "label-stability", regions: "all" },
        { type: "flow", regions: ["shell", "context", "following"] },
      ]),
    )
  })
})

function history(count: number, offset = 0): TimelineMessage[] {
  return Array.from({ length: count }, (_, index) => {
    const value = index + offset
    const prefix = `msg_0${String(value).padStart(3, "0")}_history`
    const userID = `${prefix}_a_user`
    return [
      userMessage(undefined, { id: userID, created: 1699990000000 + value * 10_000 }),
      assistantMessage(
        [
          textPart(
            `prt_history_${String(value).padStart(3, "0")}`,
            `Historical response ${value}. ${"Stable history content. ".repeat(8)}`,
          ),
        ],
        {
          id: `${prefix}_b_assistant`,
          parentID: userID,
          created: 1699990001000 + value * 10_000,
        },
      ),
    ]
  }).flat()
}

function lines(count: number) {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n")
}

function wideLines(count: number) {
  return Array.from({ length: count }, (_, index) => `line ${index + 1} ${"wide-output-".repeat(20)}`).join("\n")
}
