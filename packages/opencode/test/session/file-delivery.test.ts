// FORK-ONLY: model request file-link contract [feat: daily-file-links] 2026-11-14
import { expect, test } from "bun:test"
import type { ModelMessage } from "ai"
import { Effect } from "effect"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { FILE_DELIVERY, withFileDelivery } from "@/session/llm/file-delivery"
import { LLMRequestPrep } from "@/session/llm/request"

test("copies only the final user message; repeated preparation is idempotent", () => {
  const messages: ModelMessage[] = [
    { role: "user", content: "earlier" },
    { role: "assistant", content: "reply" },
    { role: "user", content: "create report" },
  ]
  const frozen = structuredClone(messages)
  const next = withFileDelivery(messages)
  expect(messages).toEqual(frozen)
  expect(next[0]).toBe(messages[0])
  expect(next[1]).toBe(messages[1])
  expect(next[2]?.content).toBe(`create report\n\n${FILE_DELIVERY}`)
  expect(withFileDelivery(next)).toBe(next)
})

test("preserves mixed image/file parts and tool continuation after the final user", () => {
  const messages: ModelMessage[] = [
    {
      role: "user",
      content: [
        { type: "text", text: "inspect" },
        { type: "image", image: new Uint8Array([1, 2]) },
        { type: "file", data: "data", mediaType: "application/pdf" },
      ],
    },
    {
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: "call", toolName: "read", input: { path: "/report.md" } }],
    },
    {
      role: "tool",
      content: [
        { type: "tool-result", toolCallId: "call", toolName: "read", output: { type: "text", value: "contents" } },
      ],
    },
  ]
  const before = structuredClone(messages)
  const next = withFileDelivery(messages)
  expect(messages).toEqual(before)
  expect(next.slice(1)).toEqual(messages.slice(1))
  const first = messages[0]
  const copied = next[0]
  if (first?.role !== "user" || copied?.role !== "user") throw new Error("expected user fixture")
  const content = first.content
  if (!Array.isArray(content)) throw new Error("expected multipart user fixture")
  expect(copied.content).toEqual([...content, { type: "text", text: FILE_DELIVERY }])
  expect(withFileDelivery(next)).toBe(next)
})

test("does not create a user turn or modify small internal requests", () => {
  const messages: ModelMessage[] = [{ role: "assistant", content: "continue" }]
  expect(withFileDelivery(messages)).toBe(messages)
  const user: ModelMessage[] = [{ role: "user", content: "title" }]
  expect(withFileDelivery(user, true)).toBe(user)
})

test("preserves supplied path evidence, web URLs and code examples when adding the link contract", () => {
  const content =
    "Use /tmp/project/seed 中文 %.txt and /tmp/project/generated 中文 %.md. Website: https://example.com. Code sample: `example.txt`. The two files a/same.md and b/same.md are distinct."
  const messages: ModelMessage[] = [{ role: "user", content }]
  const prepared = withFileDelivery(messages)
  expect(messages).toEqual([{ role: "user", content }])
  expect(prepared).toEqual([{ role: "user", content: `${content}\n\n${FILE_DELIVERY}` }])
  expect(withFileDelivery(prepared)).toBe(prepared)
})

test.each(["standard", "oauth", "workflow", "small", "compaction", "json_schema"] as const)(
  "shared prepare delivers the contract for %s",
  async (channel) => {
    const providerID = ProviderV2.ID.make("openai")
    const modelID = ModelV2.ID.make("gpt-5-mini")
    const sessionID = SessionSchema.ID.make("ses_file_delivery")
    const messages: ModelMessage[] = [{ role: "user", content: "create a report" }]
    const prepared = await Effect.runPromise(
      Effect.gen(function* () {
        const flags = yield* RuntimeFlags.Service
        return yield* LLMRequestPrep.prepare({
          user: {
            id: SessionV1.MessageID.make("msg_file_delivery"),
            sessionID,
            role: "user",
            time: { created: 0 },
            agent: "test",
            model: { providerID, modelID },
            format:
              channel === "json_schema"
                ? { type: "json_schema", schema: { type: "object" }, retryCount: 2 }
                : undefined,
          },
          sessionID,
          model: {
            id: modelID,
            providerID,
            api: { id: modelID, url: "https://example.test/v1", npm: "@ai-sdk/openai" },
            name: "Test",
            capabilities: {
              temperature: true,
              reasoning: false,
              attachment: true,
              toolcall: true,
              input: { text: true, audio: false, image: true, video: false, pdf: true },
              output: { text: true, audio: false, image: false, video: false, pdf: false },
              interleaved: false,
            },
            cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
            limit: { context: 128000, output: 32000 },
            status: "active",
            options: {},
            headers: {},
            release_date: "2026-01-01",
          },
          agent: {
            name: channel === "compaction" ? "compaction" : "test",
            mode: "primary",
            options: {},
            permission: [],
            prompt: "Test assistant",
          },
          system: [],
          messages,
          small: channel === "small",
          tools: {},
          provider: { id: providerID, name: "Test", source: "config", env: [], options: {}, models: {} },
          auth: channel === "oauth" ? { type: "oauth", refresh: "fixture", access: "fixture", expires: 0 } : undefined,
          plugin: {
            trigger: (_name, _input, output) => Effect.succeed(output),
            list: () => Effect.succeed([]),
            init: () => Effect.void,
          },
          flags,
          isWorkflow: channel === "workflow",
        })
      }).pipe(Effect.provide(RuntimeFlags.layer())),
    )
    expect(messages).toEqual([{ role: "user", content: "create a report" }])
    const skipped = ["small", "compaction", "json_schema"].includes(channel)
    const expected = skipped ? "create a report" : `create a report\n\n${FILE_DELIVERY}`
    // Provider bridges may discard every system message; the request user text still carries it.
    expect(prepared.messages.filter((message) => message.role !== "system").at(-1)?.content).toBe(expected)
    expect(prepared.system.join("\n").includes(FILE_DELIVERY)).toBe(!skipped)
    if (channel === "oauth") expect(prepared.params.options.instructions).toContain(FILE_DELIVERY)
    if (channel === "workflow" || channel === "oauth") expect(prepared.messages).toHaveLength(1)
  },
)
