import { afterEach, describe, expect, test } from "bun:test"
import { fetch } from "bun"
import { publishPublicShare, supportsPublicShare } from "./public-share"

// Happy DOM replaces Response/fetch; the loopback fixture must use Bun's actual transport.
const WebResponse = (await fetch("data:,fixture")).constructor as typeof Response

const document = {
  paths: {
    "/session/{sessionID}/share": {
      post: { parameters: [{ name: "shareTarget", in: "query", schema: { enum: ["cn", "global"] } }] },
    },
  },
}
const servers: ReturnType<typeof Bun.serve>[] = []
afterEach(() => {
  servers.splice(0).forEach((server) => server.stop(true))
})

function server(handler: (request: Request) => Response | Promise<Response>) {
  const value = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler })
  servers.push(value)
  return { url: value.url.href.replace(/\/$/, "") }
}

describe("public sharing capability", () => {
  test("requires the exact query contract and both destinations", () => {
    expect(supportsPublicShare(document)).toBe(true)
    for (const input of [
      null,
      {},
      { paths: [] },
      {
        paths: {
          "/session/{sessionID}/share": {
            post: {
              parameters: [
                { name: "shareTarget", in: "body", schema: { enum: ["cn", "global"] } },
                { name: "shareTarget", in: "query", schema: { enum: ["cn"] } },
              ],
            },
          },
        },
      },
    ])
      expect(supportsPublicShare(input)).toBe(false)
  })

  test("only simplified Chinese chooses the mainland service; probes use server auth", async () => {
    const connection = server((request) => {
      expect(new URL(request.url).pathname).toBe("/doc")
      expect(request.headers.get("authorization")).toBe(`Basic ${btoa("tester:password")}`)
      return WebResponse.json(document)
    })
    for (const locale of ["zh", "zht", "en", "ja", "fr"]) {
      expect(
        await publishPublicShare({
          locale,
          server: { ...connection, username: "tester", password: "password" },
          protocol: Promise.resolve("v1"),
          fetch,
          unsupported: "unsupported",
          unavailable: "unavailable",
          publish: async (target) => target,
        }),
      ).toBe(locale === "zh" ? "cn" : "global")
    }
  })

  test("old, malformed, unavailable, redirected and V2 servers never publish", async () => {
    const target = server(() => {
      throw new Error("redirect must not be followed")
    })
    for (const response of [
      WebResponse.json({ paths: {} }),
      new WebResponse("invalid"),
      new WebResponse(null, { status: 503 }),
      WebResponse.redirect(`${target.url}/doc`, 307),
    ]) {
      const connection = server(() => response.clone())
      await expect(
        publishPublicShare({
          locale: "zh",
          server: connection,
          protocol: Promise.resolve("v1"),
          fetch,
          unsupported: "unsupported",
          unavailable: "unavailable",
          publish: async () => {
            throw new Error("must not publish")
          },
        }),
      ).rejects.toThrow(response.status === 200 ? "unsupported" : "unavailable")
    }
    await expect(
      publishPublicShare({
        locale: "zh",
        server: target,
        protocol: Promise.resolve("v2"),
        fetch,
        unsupported: "unsupported",
        unavailable: "unavailable",
        publish: async () => {
          throw new Error("must not publish")
        },
      }),
    ).rejects.toThrow("unsupported")
  })

  test("keeps the click's destination and connection during an asynchronous protocol check", async () => {
    const connection = server(() => WebResponse.json(document))
    const deferred = Promise.withResolvers<"v1">()
    const input = {
      locale: "zh",
      server: connection,
      protocol: deferred.promise,
      fetch,
      unsupported: "unsupported",
      unavailable: "unavailable",
      publish: async (target: "cn" | "global") => target,
    }
    const pending = publishPublicShare(input)
    input.locale = "en"
    connection.url = "http://127.0.0.1:1"
    input.publish = async () => {
      throw new Error("publisher changed")
    }
    deferred.resolve("v1")
    expect(await pending).toBe("cn")
  })
})
