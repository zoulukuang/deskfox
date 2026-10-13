import { expect, test } from "bun:test"
import type { Message } from "@opencode-ai/sdk/v2/client"
import { createAttachmentCostMonitor } from "./attachment-cost-monitor"

function turn(
  id: string,
  input: number,
  options: { read?: number; write?: number; model?: string; completed?: boolean } = {},
): Message[] {
  return [
    {
      id,
      role: "user",
      sessionID: "s",
      time: { created: 1 },
      agent: "build",
      model: { providerID: "p", modelID: "m" },
    },
    {
      id: `a${id}`,
      role: "assistant",
      parentID: id,
      sessionID: "s",
      time: { created: 2, completed: options.completed === false ? undefined : 3 },
      providerID: "p",
      modelID: options.model ?? "m",
      agent: "build",
      mode: "build",
      path: { cwd: "/", root: "/" },
      cost: 0,
      finish: "stop",
      tokens: { input, output: 1, reasoning: 0, cache: { read: options.read ?? 0, write: options.write ?? 0 } },
    },
  ]
}

test("initial history is baseline; caches count and one user turn warns once", () => {
  const observe = createAttachmentCostMonitor()
  expect(observe({ key: "s", idle: true, messages: turn("1", 50_000) })).toBeUndefined()
  const messages = [...turn("1", 50_000), ...turn("2", 50_000, { read: 50_000, write: 50_000 })]
  expect(observe({ key: "s", idle: true, messages })).toEqual({ previous: 50_000, current: 150_000, user: "2" })
  expect(observe({ key: "s", idle: true, messages })).toBeUndefined()
  expect(observe({ key: "s", idle: true, messages: [...messages, ...turn("3", 450_000)] })?.user).toBe("3")
})

test("busy and idle-before-token events wait for a completed terminal assistant", () => {
  const observe = createAttachmentCostMonitor()
  observe({ key: "s", idle: true, messages: turn("1", 50_000) })
  expect(observe({ key: "s", idle: false, messages: turn("2", 150_000) })).toBeUndefined()
  expect(observe({ key: "s", idle: true, messages: turn("2", 150_000, { completed: false }) })).toBeUndefined()
  expect(observe({ key: "s", idle: true, messages: turn("2", 0) })).toBeUndefined()
  expect(observe({ key: "s", idle: true, messages: turn("2", 150_000) })?.current).toBe(150_000)
})

test("scope, model and revert boundaries reset comparison", () => {
  const observe = createAttachmentCostMonitor()
  observe({ key: "one/s", idle: true, messages: turn("1", 10_000) })
  expect(observe({ key: "two/s", idle: true, messages: turn("2", 200_000) })).toBeUndefined()
  expect(observe({ key: "one/s", idle: true, messages: turn("2", 200_000, { model: "other" }) })).toBeUndefined()
  expect(observe({ key: "one/s", idle: true, reset: "revert", messages: turn("3", 900_000) })).toBeUndefined()
})

test("late cache statistics can cross the threshold after an idle completed event", () => {
  const observe = createAttachmentCostMonitor()
  observe({ key: "s", idle: true, messages: turn("1", 50_000) })
  expect(observe({ key: "s", idle: true, messages: turn("2", 50_000) })).toBeUndefined()
  const messages = turn("2", 50_000, { read: 50_000, write: 50_000 })
  expect(observe({ key: "s", idle: true, messages })).toEqual({ previous: 50_000, current: 150_000, user: "2" })
  expect(observe({ key: "s", idle: true, messages })).toBeUndefined()
})

test("small absolute or relative growth never warns, and provider steps are not summed", () => {
  const observe = createAttachmentCostMonitor()
  observe({ key: "s", idle: true, messages: turn("1", 40_000) })
  expect(observe({ key: "s", idle: true, messages: turn("2", 120_000) })).toBeUndefined()
  expect(observe({ key: "s", idle: true, messages: turn("3", 240_000) })).toBeUndefined()
  const messages = turn("4", 250_000)
  messages.splice(1, 0, { ...messages[1], id: "tool-step" } as Message)
  expect(observe({ key: "s", idle: true, messages })).toBeUndefined()
})
