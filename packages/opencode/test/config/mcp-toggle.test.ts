import path from "node:path"
import { chmod, mkdir, symlink } from "node:fs/promises"
import { expect, test } from "bun:test"
import { mcpEnabledOverrides, saveMcpEnabled } from "../../src/config/mcp-toggle"
import { ConfigParse } from "../../src/config/parse"
import { tmpdir } from "../fixture/fixture"

test("desktop project replay contains only explicit boolean MCP switch leaves", () => {
  expect(
    mcpEnabledOverrides({
      username: "project",
      model: "project/model",
      permission: { "*": "allow" },
      mcp: {
        on: { enabled: true, command: ["project-command"], environment: { TOKEN: "fixture" } },
        off: { enabled: false, url: "https://project.invalid", headers: { Authorization: "fixture" } },
        unset: { type: "local", command: ["untouched"] },
        invalid: { enabled: "false" },
      },
    }),
  ).toEqual({ mcp: { on: { enabled: true }, off: { enabled: false } } })
  expect(mcpEnabledOverrides(undefined)).toEqual({ mcp: {} })
})

test("patches only enabled and preserves comments, placeholders and concurrent keys", async () => {
  await using project = await tmpdir()
  const file = path.join(project.path, ".opencode/opencode.jsonc")
  await Bun.write(
    file,
    '{ // retained\n "mcp": {"same": {"type":"remote","url":"{env:MCP_URL}","headers":{"Authorization":"secret"}}},"username":"keep"}',
  )
  await Promise.all([saveMcpEnabled(project.path, "same", false), saveMcpEnabled(project.path, "other", true)])
  const text = await Bun.file(file).text()
  expect(text).toContain("// retained")
  expect(ConfigParse.jsonc(text, file)).toEqual({
    mcp: {
      same: { type: "remote", url: "{env:MCP_URL}", headers: { Authorization: "secret" }, enabled: false },
      other: { enabled: true },
    },
    username: "keep",
  })
})

test("same names in different projects have independent intent", async () => {
  await using first = await tmpdir()
  await using second = await tmpdir()
  await saveMcpEnabled(first.path, "same", false)
  await saveMcpEnabled(second.path, "same", true)
  expect((await Bun.file(path.join(first.path, ".opencode/opencode.jsonc")).json()).mcp.same.enabled).toBe(false)
  expect((await Bun.file(path.join(second.path, ".opencode/opencode.jsonc")).json()).mcp.same.enabled).toBe(true)
})

test("invalid JSONC and read-only settings fail without overwriting the original", async () => {
  await using project = await tmpdir()
  const file = path.join(project.path, ".opencode/opencode.jsonc")
  await Bun.write(file, "{ broken")
  await expect(saveMcpEnabled(project.path, "same", false)).rejects.toThrow()
  expect(await Bun.file(file).text()).toBe("{ broken")
  await Bun.write(file, "{}")
  await chmod(file, 0o444)
  await expect(saveMcpEnabled(project.path, "same", false)).rejects.toThrow("read-only")
  expect(await Bun.file(file).text()).toBe("{}")
  await chmod(file, 0o600)
})

test("linked config directories and files cannot write another project's config", async () => {
  await using project = await tmpdir()
  await using other = await tmpdir()
  await symlink(other.path, path.join(project.path, ".opencode"), "dir")
  await expect(saveMcpEnabled(project.path, "same", false)).rejects.toThrow("inside the current project")
  expect(await Bun.file(path.join(other.path, "opencode.jsonc")).exists()).toBe(false)
  await using linked = await tmpdir()
  await mkdir(path.join(linked.path, ".opencode"))
  const target = path.join(other.path, "opencode.jsonc")
  await Bun.write(target, "{}")
  await symlink(target, path.join(linked.path, ".opencode/opencode.jsonc"))
  await expect(saveMcpEnabled(linked.path, "same", false)).rejects.toThrow("linked configuration")
  expect(await Bun.file(target).text()).toBe("{}")
})
