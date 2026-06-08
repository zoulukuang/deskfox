import { describe, expect, test } from "bun:test"
import type { ConfigInvalidError, ProviderModelNotFoundError } from "./server-errors"
import { formatServerError, isBackendUnreachableError, parseReadableConfigInvalidError } from "./server-errors"

function fill(text: string, vars?: Record<string, string | number>) {
  if (!vars) return text
  return text.replace(/{{\s*(\w+)\s*}}/g, (_, key: string) => {
    const value = vars[key]
    if (value === undefined) return ""
    return String(value)
  })
}

function useLanguageMock() {
  const dict: Record<string, string> = {
    "error.chain.unknown": "Erro desconhecido",
    "error.chain.configInvalid": "Arquivo de config em {{path}} invalido",
    "error.chain.configInvalidWithMessage": "Arquivo de config em {{path}} invalido: {{message}}",
    "error.chain.modelNotFound": "Modelo nao encontrado: {{provider}}/{{model}}",
    "error.chain.didYouMean": "Voce quis dizer: {{suggestions}}",
    "error.chain.checkConfig": "Revise provider/model no config",
  }
  return {
    t(key: string, vars?: Record<string, string | number>) {
      const text = dict[key]
      if (!text) return key
      return fill(text, vars)
    },
  }
}

const language = useLanguageMock()

describe("parseReadableConfigInvalidError", () => {
  test("formats issues with file path", () => {
    const error = {
      name: "ConfigInvalidError",
      data: {
        path: "opencode.config.ts",
        issues: [
          { path: ["settings", "host"], message: "Required" },
          { path: ["mode"], message: "Invalid" },
        ],
      },
    } satisfies ConfigInvalidError

    const result = parseReadableConfigInvalidError(error, language.t)

    expect(result).toBe(
      ["Arquivo de config em opencode.config.ts invalido: settings.host: Required", "mode: Invalid"].join("\n"),
    )
  })

  test("uses trimmed message when issues are missing", () => {
    const error = {
      name: "ConfigInvalidError",
      data: {
        path: "config",
        message: "  Bad value  ",
      },
    } satisfies ConfigInvalidError

    const result = parseReadableConfigInvalidError(error, language.t)

    expect(result).toBe("Arquivo de config em config invalido: Bad value")
  })
})

describe("formatServerError", () => {
  test("formats config invalid errors", () => {
    const error = {
      name: "ConfigInvalidError",
      data: {
        message: "Missing host",
      },
    } satisfies ConfigInvalidError

    const result = formatServerError(error, language.t)

    expect(result).toBe("Arquivo de config em config invalido: Missing host")
  })

  test("returns error messages", () => {
    expect(formatServerError(new Error("Request failed with status 503"), language.t)).toBe(
      "Request failed with status 503",
    )
  })

  test("returns provided string errors", () => {
    expect(formatServerError("Failed to connect to server", language.t)).toBe("Failed to connect to server")
  })

  test("uses translated unknown fallback", () => {
    expect(formatServerError(0, language.t)).toBe("Erro desconhecido")
  })

  test("falls back for unknown error objects and names", () => {
    expect(formatServerError({ name: "ServerTimeoutError", data: { seconds: 30 } }, language.t)).toBe(
      "Erro desconhecido",
    )
  })

  test("formats provider model errors using provider/model", () => {
    const error = {
      name: "ProviderModelNotFoundError",
      data: {
        providerID: "openai",
        modelID: "gpt-4.1",
      },
    } satisfies ProviderModelNotFoundError

    expect(formatServerError(error, language.t)).toBe(
      ["Modelo nao encontrado: openai/gpt-4.1", "Revise provider/model no config"].join("\n"),
    )
  })

  test("formats provider model suggestions", () => {
    const error = {
      name: "ProviderModelNotFoundError",
      data: {
        providerID: "x",
        modelID: "y",
        suggestions: ["x/y2", "x/y3"],
      },
    } satisfies ProviderModelNotFoundError

    expect(formatServerError(error, language.t)).toBe(
      ["Modelo nao encontrado: x/y", "Voce quis dizer: x/y2, x/y3", "Revise provider/model no config"].join("\n"),
    )
  })
})

describe("isBackendUnreachableError [feat: coldstart-toast-race]", () => {
  test("识别实测 reqwest 连接错(Error 形态)", () => {
    const e = new Error("error sending request for url (http://127.0.0.1:64796/session?directory=%2FUsers%2Fx)")
    expect(isBackendUnreachableError(e)).toBe(true)
  })

  test("识别同样信息的 string 形态(setLoadError/tree onError 传 message 字符串)", () => {
    const msg = "error sending request for url (http://127.0.0.1:64796/file/content?path=a.md)"
    expect(isBackendUnreachableError(msg)).toBe(true)
  })

  test("识别 web fetch 网络错变体", () => {
    expect(isBackendUnreachableError(new Error("Failed to fetch"))).toBe(true)
    expect(isBackendUnreachableError(new Error("NetworkError when attempting to fetch resource"))).toBe(true)
    expect(isBackendUnreachableError("Connection refused (os error 61)")).toBe(true)
    expect(isBackendUnreachableError(new Error("tcp connect error: Connection refused"))).toBe(true)
  })

  test("大小写不敏感", () => {
    expect(isBackendUnreachableError("ERROR Sending Request for url (...)")).toBe(true)
  })

  test("HTTP 4xx/5xx 业务/服务故障不视为不可达(应正常 surface)", () => {
    expect(isBackendUnreachableError(new Error("Server returned 404 with empty body: /session"))).toBe(false)
    expect(isBackendUnreachableError(new Error("Internal Server Error"))).toBe(false)
    expect(isBackendUnreachableError(new Error("Unauthorized"))).toBe(false)
  })

  test("空/非错误输入安全返回 false", () => {
    expect(isBackendUnreachableError(undefined)).toBe(false)
    expect(isBackendUnreachableError(null)).toBe(false)
    expect(isBackendUnreachableError("")).toBe(false)
    expect(isBackendUnreachableError({})).toBe(false)
    expect(isBackendUnreachableError(new Error("something unrelated broke"))).toBe(false)
  })
})
