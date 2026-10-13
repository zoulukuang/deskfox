// [fork-only] C0 characterization; replace defect assertions when implementing C1.
import { expect, test } from "bun:test"
import { LLM, LLMClient, Model } from "@opencode-ai/llm"
import { OpenAIChat } from "@opencode-ai/llm/protocols/openai-chat"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { toLLMMessages } from "@opencode-ai/core/session/runner/to-llm-message"
import { DateTime, Effect } from "effect"
import path from "path"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ReadToolFileSystem } from "@opencode-ai/core/tool/read-filesystem"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { FileSystem } from "effect"

test("C0 baseline: V2 model projection preserves text media and OpenAI Chat rejects it before send", async () => {
  const text = "row,attachment-c0-marker,1234567890\n".repeat(24_000)
  const uri = `data:text/plain;base64,${Buffer.from(text).toString("base64")}`
  const messages = toLLMMessages(
    [
      SessionMessage.User.make({
        id: SessionMessage.ID.create(),
        type: "user",
        text: "Inspect the attachment",
        files: [{ uri, mime: "text/plain", name: "baseline.csv" }],
        time: { created: DateTime.makeUnsafe(0) },
      }),
    ],
    Model.make({ id: "model", provider: "provider", route: OpenAIChat.route }),
  )
  expect(messages[0]?.content).toContainEqual({
    type: "media",
    mediaType: "text/plain",
    data: uri,
    filename: "baseline.csv",
    metadata: undefined,
  })
  const error = await Effect.runPromise(
    LLMClient.prepare(LLM.request({ model: OpenAIChat.route.model({ id: "test" }), messages })).pipe(Effect.flip),
  )
  expect(error.message).toContain("does not support media type text/plain")
  console.log(
    JSON.stringify({
      probe: "C0-v2-projection",
      attachmentBytes: Buffer.byteLength(text),
      dataUrlBytes: uri.length,
      bounded: false,
      wireOutcome: error.message,
    }),
  )
})

test("C0 baseline: V2 read small files bypasses paging and rejects PDF", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const files = yield* FileSystem.FileSystem
      const dir = yield* files.makeTempDirectoryScoped()
      const text = "a\n".repeat(3_000)
      const txt = path.join(dir, "lines.txt")
      yield* files.writeFileString(txt, text)
      const result = yield* ReadToolFileSystem.read(fs, txt, "lines.txt")
      expect(result.content).toBe(text)
      const pdf = path.join(dir, "manual.pdf")
      yield* files.writeFileString(pdf, "%PDF-1.7")
      const error = yield* ReadToolFileSystem.read(fs, pdf, "manual.pdf").pipe(Effect.flip)
      expect(error).toBeInstanceOf(ReadToolFileSystem.BinaryFileError)
      console.log(
        JSON.stringify({
          probe: "C0-v2-read",
          inputLines: 3_000,
          returnedBytes: Buffer.byteLength(result.content),
          pdf: error._tag,
        }),
      )
    }).pipe(
      Effect.scoped,
      Effect.provide(LayerNode.compile(LayerNode.group([FSUtil.node, LayerNodePlatform.filesystem]))),
    ),
  )
})
