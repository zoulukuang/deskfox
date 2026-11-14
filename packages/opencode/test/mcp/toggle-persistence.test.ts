import path from "node:path"
import { chmod, rm } from "node:fs/promises"
import { expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Global } from "@opencode-ai/core/global"
import { Effect, Exit, Fiber } from "effect"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { MCP } from "../../src/mcp"
import { TestInstance, reloadInstance, tmpdirScoped, provideInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { McpOAuthCallback } from "../../src/mcp/oauth-callback"
import { Config } from "../../src/config/config"

const it = testEffect(LayerNode.compile(LayerNode.group([MCP.node, Config.node, CrossSpawnSpawner.node])))
const command = [process.execPath, path.join(import.meta.dir, "../fixture/mcp-lifecycle-stdio.ts")]

it.instance(
  "disabled MCP survives instance recreation without changing its connection config",
  () =>
    Effect.gen(function* () {
      const mcp = yield* MCP.Service
      const instance = yield* TestInstance
      const original = yield* Effect.promise(() => Bun.file(path.join(instance.directory, "opencode.json")).text())
      expect((yield* mcp.status()).fixture.status).toBe("connected")
      yield* mcp.disconnect("fixture")
      expect((yield* mcp.tools()).fixture_current_directory).toBeUndefined()
      yield* reloadInstance({ directory: instance.directory })
      expect((yield* mcp.status()).fixture.status).toBe("disabled")
      expect(yield* Effect.promise(() => Bun.file(path.join(instance.directory, "opencode.json")).text())).toBe(
        original,
      )
      yield* mcp.connect("fixture")
      expect((yield* mcp.status()).fixture.status).toBe("connected")
      yield* reloadInstance({ directory: instance.directory })
      expect((yield* mcp.status()).fixture.status).toBe("connected")
    }),
  { config: { mcp: { fixture: { type: "local", command } } } },
)

it.instance(
  "save failure leaves the connected client usable",
  () =>
    Effect.gen(function* () {
      const mcp = yield* MCP.Service
      const instance = yield* TestInstance
      expect((yield* mcp.status()).fixture.status).toBe("connected")
      const file = path.join(instance.directory, ".opencode/opencode.jsonc")
      yield* Effect.promise(() => Bun.write(file, "{}"))
      yield* Effect.promise(() => chmod(file, 0o444))
      const result = yield* mcp.disconnect("fixture").pipe(Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
      expect((yield* mcp.status()).fixture.status).toBe("connected")
      expect((yield* mcp.tools()).fixture_current_directory).toBeDefined()
      yield* Effect.promise(() => chmod(file, 0o600))
    }),
  { config: { mcp: { fixture: { type: "local", command } } } },
)

for (const action of ["connect", "authenticate", "connect-save-failure"] as const) {
  it.instance(
    action === "connect-save-failure"
      ? "failed close leaves the in-flight connect valid"
      : `closing while ${action} lists tools rejects the late client`,
    () =>
      Effect.gen(function* () {
        const mcp = yield* MCP.Service
        const instance = yield* TestInstance
        const started = Promise.withResolvers<void>()
        const release = Promise.withResolvers<void>()
        const protocol = new Server({ name: "toggle-race", version: "1" }, { capabilities: { tools: {} } })
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          enableJsonResponse: true,
        })
        protocol.setRequestHandler(ListToolsRequestSchema, async () => {
          started.resolve()
          await release.promise
          return { tools: [{ name: "late", inputSchema: { type: "object" as const } }] }
        })
        yield* Effect.promise(() => protocol.connect(transport))
        const http = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => transport.handleRequest(request) })
        yield* Effect.addFinalizer(() =>
          Effect.promise(async () => {
            release.resolve()
            await protocol.close()
            http.stop(true)
            await McpOAuthCallback.stop()
          }),
        )
        yield* mcp.add("fixture", { type: "remote", url: http.url.toString(), enabled: false })
        const pending = yield* mcp[action === "authenticate" ? "authenticate" : "connect"]("fixture").pipe(
          Effect.forkScoped,
        )
        yield* Effect.promise(() => started.promise)
        if (action === "connect-save-failure") {
          const file = path.join(instance.directory, ".opencode/opencode.jsonc")
          yield* Effect.promise(() => chmod(file, 0o444))
          expect(Exit.isFailure(yield* mcp.disconnect("fixture").pipe(Effect.exit))).toBe(true)
          yield* Effect.promise(() => chmod(file, 0o600))
        }
        if (action !== "connect-save-failure") yield* mcp.disconnect("fixture")
        release.resolve()
        yield* Fiber.join(pending)
        expect((yield* mcp.status()).fixture.status).toBe(action === "connect-save-failure" ? "connected" : "disabled")
        expect(Boolean((yield* mcp.tools()).fixture_late)).toBe(action === "connect-save-failure")
      }),
  )
}

it.instance("a global MCP definition can be disabled in one project without changing the other", () =>
  Effect.gen(function* () {
    const mcp = yield* MCP.Service
    const config = yield* Config.Service
    const file = path.join(Global.Path.config, "opencode.jsonc")
    const before = yield* Effect.promise(async () =>
      (await Bun.file(file).exists()) ? Bun.file(file).text() : undefined,
    )
    yield* Effect.promise(() => Bun.write(file, JSON.stringify({ mcp: { fixture: { type: "local", command } } })))
    yield* config.invalidate()
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          if (before === undefined) await rm(file, { force: true })
          else await Bun.write(file, before)
        })
        yield* config.invalidate()
      }),
    )
    expect((yield* mcp.status()).fixture.status).toBe("connected")
    yield* mcp.disconnect("fixture")
    const other = yield* tmpdirScoped()
    expect((yield* mcp.status().pipe(provideInstance(other))).fixture.status).toBe("connected")
    expect((yield* mcp.status()).fixture.status).toBe("disabled")
    expect((yield* Effect.promise(() => Bun.file(file).json())).mcp.fixture.enabled).toBeUndefined()
  }),
)

it.instance(
  "connection failure stays failed and does not erase the saved enable intent",
  () =>
    Effect.gen(function* () {
      const mcp = yield* MCP.Service
      const instance = yield* TestInstance
      yield* mcp.connect("fixture")
      expect((yield* mcp.status()).fixture.status).toBe("failed")
      expect(
        (yield* Effect.promise(() => Bun.file(path.join(instance.directory, ".opencode/opencode.jsonc")).json())).mcp
          .fixture.enabled,
      ).toBe(true)
    }),
  { config: { mcp: { fixture: { type: "local", command: ["/nonexistent/deskfox-mcp-test"], enabled: false } } } },
)

it.instance(
  "rapid toggles persist and apply the last intent",
  () =>
    Effect.gen(function* () {
      const mcp = yield* MCP.Service
      const instance = yield* TestInstance
      yield* mcp.status()
      yield* Effect.all([mcp.connect("fixture"), mcp.disconnect("fixture"), mcp.connect("fixture")], {
        concurrency: "unbounded",
      })
      expect((yield* mcp.status()).fixture.status).toBe("connected")
      yield* Effect.all([mcp.connect("fixture"), mcp.disconnect("fixture")], { concurrency: "unbounded" })
      expect((yield* mcp.status()).fixture.status).toBe("disabled")
      expect((yield* mcp.tools()).fixture_current_directory).toBeUndefined()
      expect(
        (yield* Effect.promise(() => Bun.file(path.join(instance.directory, ".opencode/opencode.jsonc")).json())).mcp
          .fixture.enabled,
      ).toBe(false)
    }),
  { config: { mcp: { fixture: { type: "local", command, enabled: false } } } },
)

it.instance(
  "higher-priority disabled configuration cannot be forced on",
  () =>
    Effect.gen(function* () {
      const mcp = yield* MCP.Service
      const previous = process.env.OPENCODE_CONFIG_CONTENT
      process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ mcp: { fixture: { enabled: false } } })
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (previous === undefined) delete process.env.OPENCODE_CONFIG_CONTENT
          else process.env.OPENCODE_CONFIG_CONTENT = previous
        }),
      )
      expect((yield* mcp.status()).fixture.status).toBe("disabled")
      expect(Exit.isFailure(yield* mcp.connect("fixture").pipe(Effect.exit))).toBe(true)
      expect((yield* mcp.status()).fixture.status).toBe("disabled")
      expect((yield* mcp.tools()).fixture_current_directory).toBeUndefined()
    }),
  { config: { mcp: { fixture: { type: "local", command } } } },
)
