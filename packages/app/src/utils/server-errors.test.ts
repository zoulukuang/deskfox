import { describe, expect, test } from "bun:test"
import type { ConfigInvalidError, ProviderModelNotFoundError } from "./server-errors"
import {
  formatServerError,
  parseReadableConfigInvalidError,
  isTransientServerError,
  isRetryableListError,
  isBackendUnreachableError,
} from "./server-errors"

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

  test("unwraps SDK-wrapped errors from cause.body", () => {
    const body = {
      name: "ConfigInvalidError",
      data: {
        message: "Missing host",
      },
    } satisfies ConfigInvalidError

    const wrapped = new Error("ConfigInvalidError", { cause: { body, status: 400 } })

    expect(formatServerError(wrapped, language.t)).toBe("Arquivo de config em config invalido: Missing host")
  })
})

// [bug-repro: 启动时 file.list 返回 500「Unexpected server error」弹红 toast(冷启动时序)] 2026-06-13
describe("cold-start file.list transient error classification", () => {
  test("冷启动通用 500 文案被识别为瞬时(应重试,不弹 toast)", () => {
    const err = new Error("Unexpected server error. Check server logs for details.")
    expect(isTransientServerError(err)).toBe(true)
    expect(isRetryableListError(err)).toBe(true)
  })

  test("连接级不可达仍可重试", () => {
    const err = new Error("error sending request for url (http://127.0.0.1:4096/file)")
    expect(isBackendUnreachableError(err)).toBe(true)
    expect(isRetryableListError(err)).toBe(true)
  })

  test("真实业务 5xx(带具体信息)不误判为瞬时 → 正常 surface", () => {
    const err = new Error("ripgrep exited with code 2: invalid glob pattern")
    expect(isTransientServerError(err)).toBe(false)
    expect(isRetryableListError(err)).toBe(false)
  })

  test("纯字符串 / 空错误安全处理", () => {
    expect(isTransientServerError("Unexpected server error. Check server logs for details.")).toBe(true)
    expect(isTransientServerError("")).toBe(false)
    expect(isTransientServerError(null)).toBe(false)
    expect(isRetryableListError(undefined)).toBe(false)
  })
})
