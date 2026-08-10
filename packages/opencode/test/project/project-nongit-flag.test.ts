/**
 * REQ-069 U6 — nonGitFolderIdentity feature flag 独立测试
 * 仅测 flag 本体三态:默认关 / env 开 / layer override
 * fromDirectory 两态行为断言归 U4 测试(测试内生裁决)
 */
import { describe, expect } from "bun:test"
import { ConfigProvider, Effect, Layer } from "effect"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { it } from "../lib/effect"

// 2026-08-11 sync v1.17.13:上游 defaultLayer 移除,直接用 Service.layer 提供 config
const fromConfig = (input: Record<string, unknown>) =>
  RuntimeFlags.Service.layer.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(input))), Layer.orDie)

const readFlags = RuntimeFlags.Service.useSync((flags) => flags)

describe("nonGitFolderIdentity feature flag (REQ-069 U6)", () => {
  it.effect("defaults to false when env var is absent", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(Effect.provide(fromConfig({})))

      expect(flags.nonGitFolderIdentity).toBe(false)
    }),
  )

  it.effect("is enabled when OPENCODE_EXPERIMENTAL_NONGIT_IDENTITY=true", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(
        Effect.provide(fromConfig({ OPENCODE_EXPERIMENTAL_NONGIT_IDENTITY: "true" })),
      )

      expect(flags.nonGitFolderIdentity).toBe(true)
    }),
  )

  it.effect("can be overridden to true via RuntimeFlags.layer in tests", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(Effect.provide(RuntimeFlags.layer({ nonGitFolderIdentity: true })))

      expect(flags.nonGitFolderIdentity).toBe(true)
    }),
  )

  it.effect("can be overridden to false via RuntimeFlags.layer in tests", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(
        Effect.provide(RuntimeFlags.layer({ nonGitFolderIdentity: false })),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ OPENCODE_EXPERIMENTAL_NONGIT_IDENTITY: "true" }))),
      )

      expect(flags.nonGitFolderIdentity).toBe(false)
    }),
  )

  it.effect("is not enabled by OPENCODE_EXPERIMENTAL umbrella (isolated flag, no enabledByExperimental)", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(Effect.provide(fromConfig({ OPENCODE_EXPERIMENTAL: "true" })))

      expect(flags.nonGitFolderIdentity).toBe(false)
    }),
  )
})
