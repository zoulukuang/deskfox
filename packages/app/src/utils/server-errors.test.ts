import { describe, expect, test } from "bun:test"
import type { SessionNotFoundError } from "@opencode-ai/sdk/v2/client"
import type { ConfigInvalidError, ProviderModelNotFoundError } from "./server-errors"
import {
  formatServerError,
  isSessionNotFoundError,
  parseReadableConfigInvalidError,
  isTransientServerError,
  isRetryableListError,
  isBackendUnreachableError,
  isUnservableDirError,
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

// FORK: REQ-072 切到缺失目录项目 503 空 body 识别(suppress 冗余 toast) [feat: project-continuity-v2026-8-4]
describe("isUnservableDirError (切缺失目录项目 503 空 body)", () => {
  test("Server returned 503 with empty body → true(缺失目录签名)", () => {
    const err = new Error("Server returned 503 with empty body: http://127.0.0.1:57684/file?path=&directory=%2FUsers%2Fx%2Frtgit-renamed")
    expect(isUnservableDirError(err)).toBe(true)
  })
  test("纯字符串同样识别", () => {
    expect(isUnservableDirError("Server returned 503 with empty body: ...")).toBe(true)
  })
  test("真实业务 5xx(带具体信息)不误判 → 照常 surface", () => {
    expect(isUnservableDirError(new Error("ripgrep exited with code 2: invalid glob"))).toBe(false)
    expect(isUnservableDirError(new Error("Server returned 500: file too large"))).toBe(false)
  })
  test("非可重试(目录真没了,重试无用)—— 独立于 isRetryableListError", () => {
    const err = new Error("Server returned 503 with empty body: http://.../file")
    expect(isUnservableDirError(err)).toBe(true)
    expect(isRetryableListError(err)).toBe(false)
  })
  test("空/null 安全", () => {
    expect(isUnservableDirError("")).toBe(false)
    expect(isUnservableDirError(null)).toBe(false)
    expect(isUnservableDirError(undefined)).toBe(false)
  })
})

describe("isSessionNotFoundError", () => {
  test("matches an SDK-wrapped error for the requested session", () => {
    const body = {
      _tag: "SessionNotFoundError",
      sessionID: "ses_missing",
      message: "Session not found",
    } satisfies SessionNotFoundError

    expect(isSessionNotFoundError(new Error(body.message, { cause: { body, status: 404 } }), body.sessionID)).toBe(true)
  })

  test("rejects errors for other sessions and other 404 responses", () => {
    const body = {
      _tag: "SessionNotFoundError",
      sessionID: "ses_parent",
      message: "Session not found",
    } satisfies SessionNotFoundError

    expect(isSessionNotFoundError(new Error(body.message, { cause: { body, status: 404 } }), "ses_tab")).toBe(false)
    expect(
      isSessionNotFoundError(
        new Error("Provider not found", {
          cause: { body: { _tag: "ProviderNotFoundError", providerID: "missing" }, status: 404 },
        }),
        "ses_tab",
      ),
    ).toBe(false)
  })
})
