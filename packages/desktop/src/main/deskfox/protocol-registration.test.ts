// [fork-only] Protect the installed application's URL ownership during local QA.
import { describe, expect, test } from "bun:test"
import { registerDeskfoxProtocol } from "./protocol-registration"

describe("protocol ownership", () => {
  test("packaged local never changes the default handler", () => {
    const calls: string[] = []
    registerDeskfoxProtocol({ isPackaged: true, setAsDefaultProtocolClient: (scheme) => !!calls.push(scheme) }, "local")
    expect(calls).toEqual([])
  })

  test("unpackaged development never changes the default handler", () => {
    const calls: string[] = []
    registerDeskfoxProtocol({ isPackaged: false, setAsDefaultProtocolClient: (scheme) => !!calls.push(scheme) }, "dev")
    expect(calls).toEqual([])
  })

  test.each(["prod", "beta", "dev"])("packaged %s preserves existing registration", (channel) => {
    const calls: string[] = []
    registerDeskfoxProtocol({ isPackaged: true, setAsDefaultProtocolClient: (scheme) => !!calls.push(scheme) }, channel)
    expect(calls).toEqual(["opencode"])
  })
})
