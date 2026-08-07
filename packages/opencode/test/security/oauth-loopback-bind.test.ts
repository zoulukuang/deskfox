// [fork-only] REQ-019 OAuth callback server 必须绑环回地址 [feat: oauth-loopback-bind] 2026-08-07
//
// R6(网络监听安全,2026-05-10 立):任何 *.listen() 必须显式指定 loopback hostname。
// Node 的 listen(port, cb) 默认绑 0.0.0.0 → 把 OAuth 回调端口暴露到所有网卡(LAN/公网),
// 窗口期内同网段任何人都能连上并投递构造的 code/state。上游三处遗漏了 hostname
// (digitalocean.ts / openai/codex.ts / mcp/oauth-callback.ts),而上游自己的 plugin/xai.ts:502
// 就是正确写法 —— 说明是遗漏而非设计选择。
//
// 本文件是【静态守卫】:上游后续再复制出第四处、第五处裸 listen 时,这条直接红,
// 不必等人肉 merge 检查(merge checklist 的 §5.6 是同一条 grep 的人工版)。
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Glob } from "bun"

const SRC = join(import.meta.dir, "../../src")

/** `.listen(<something>, () => ...)` —— 第二个参数直接是回调 = 没传 hostname。 */
const BARE_LISTEN = /\.listen\([^,)]+,\s*(\(\s*\)|async\s*\(\s*\))\s*=>/

describe("REQ-019 OAuth 回调 server 绑环回地址", () => {
  test("packages/opencode/src 下不存在裸 listen(port, cb)(默认会绑 0.0.0.0)", async () => {
    const offenders: string[] = []
    for await (const file of new Glob("**/*.ts").scan({ cwd: SRC, absolute: true })) {
      const text = readFileSync(file, "utf-8")
      text.split("\n").forEach((line, i) => {
        if (BARE_LISTEN.test(line)) offenders.push(`${file.slice(SRC.length + 1)}:${i + 1}  ${line.trim()}`)
      })
    }
    expect(
      offenders,
      `发现裸 listen(未指定 hostname → 默认 0.0.0.0),按 REQ-019 补 "127.0.0.1"\n` +
        `参考写法:packages/opencode/src/plugin/xai.ts:502 server.listen(OAUTH_PORT, OAUTH_HOST, ...)\n` +
        offenders.join("\n"),
    ).toEqual([])
  })

  test("三处已知 OAuth callback server 明确绑 127.0.0.1", () => {
    const sites = [
      "plugin/digitalocean.ts",
      "plugin/openai/codex.ts",
      "mcp/oauth-callback.ts",
      "plugin/xai.ts", // 上游自带的正确写法,一并守住
    ]
    for (const rel of sites) {
      const text = readFileSync(join(SRC, rel), "utf-8")
      const listens = text.split("\n").filter((l) => l.includes(".listen("))
      expect(listens.length, `${rel} 应有 listen 调用`).toBeGreaterThan(0)
      for (const line of listens) {
        expect(line, `${rel} 的 listen 必须带环回 hostname`).toMatch(/"127\.0\.0\.1"|OAUTH_HOST/)
      }
    }
  })

  // redirect_uri 必须与 provider 端注册值逐字匹配 —— 顺手把 localhost 改成 127.0.0.1
  // 会换来 redirect_uri mismatch,把一个安全小修变成功能故障。这条把口头约束变成机器约束。
  test("三处 redirect URI 字面量保持不动(改了会 redirect_uri mismatch)", () => {
    /** 只抽含 redirect 语义的行,避免断言失败时打印整份源码。 */
    const redirectLines = (rel: string) =>
      readFileSync(join(SRC, rel), "utf-8")
        .split("\n")
        .filter(
          (l) =>
            /redirect_uri|redirectUri|auth\/callback|OAUTH_REDIRECT_PATH|OAUTH_CALLBACK_PATH/.test(l) &&
            l.includes("http://"),
        )

    const codex = redirectLines("plugin/openai/codex.ts")
    expect(codex.length, "codex.ts 应有 redirect URI 字面量").toBeGreaterThan(0)
    for (const line of codex) expect(line, "codex redirect 必须仍是 localhost").toContain("http://localhost:")

    const digitalocean = redirectLines("plugin/digitalocean.ts")
    expect(digitalocean.length, "digitalocean.ts 应有 redirect URI 字面量").toBeGreaterThan(0)
    for (const line of digitalocean)
      expect(line, "digitalocean redirect 必须仍是 localhost").toContain("http://localhost:")

    // MCP 侧本来就是 IP 字面量(零风险),守住别被"统一成 localhost"改回去
    const provider = redirectLines("mcp/oauth-provider.ts")
    expect(provider.length, "oauth-provider.ts 应有 redirect URI 字面量").toBeGreaterThan(0)
    for (const line of provider) expect(line, "MCP redirect 必须仍是 127.0.0.1").toContain("http://127.0.0.1:")
  })
})
