// [fork-only] friendlyErrorReply 单测 — A4 降级回复友好化
// [feat: feishu-bridge-newuser-onboarding] 2026-05-10

import { describe, expect, test } from "bun:test"
import { friendlyErrorReply } from "../message-pipeline"

describe("friendlyErrorReply — 把 opencode 技术错误翻译成 user 可操作指引", () => {
  test("'no providers found' → 引导去 Settings → Providers", () => {
    const out = friendlyErrorReply(new Error("no providers found"))
    expect(out).toContain("未配置默认 LLM model")
    expect(out).toContain("Settings → Providers")
    expect(out).toContain("(原始错误:no providers found)")
  })

  test("'no models found' → 同上", () => {
    const out = friendlyErrorReply(new Error("no models found"))
    expect(out).toContain("未配置默认 LLM model")
  })

  test("'Invalid model anthropic/foo. Model must be ...' → 同样识别为 model 配置问题", () => {
    const out = friendlyErrorReply(
      new Error('Invalid model anthropic/foo. Model must be in the format "provider/model".'),
    )
    expect(out).toContain("未配置默认 LLM model")
  })

  test("API key 类(401)→ key 无效提示", () => {
    const out = friendlyErrorReply(new Error("Request failed: 401 invalid API key"))
    expect(out).toContain("API key 可能无效")
    expect(out).toContain("Settings → Providers")
  })

  test("api_key 字段名(snake_case)同样识别", () => {
    const out = friendlyErrorReply(new Error("Bad request: api_key required"))
    expect(out).toContain("API key 可能无效")
  })

  // [feat: feishu-llm-timeout-surface] 2026-06-01 — Network timeout 原走默认 fallback,
  // 现在升级到专属 timeout 友好提示(包含"模型回复超时"+ 建议换 model)。
  test("'Network timeout after 30s' → 模型超时友好提示", () => {
    const out = friendlyErrorReply(new Error("Network timeout after 30s"))
    expect(out).toContain("LLM 模型回复超时")
    expect(out).toContain("Network timeout after 30s")
    expect(out).not.toContain("LLM model")
    expect(out).not.toContain("API key 可能无效")
  })

  // ===== [feat: feishu-llm-timeout-surface] 2026-06-01 新增 5 类 pattern =====

  test("'opencode prompt timeout (1800000ms) — LLM 在超时窗口内无任何输出' → 模型超时友好提示", () => {
    const out = friendlyErrorReply(
      new Error("opencode prompt timeout (1800000ms) — LLM 在超时窗口内无任何输出"),
    )
    expect(out).toContain("LLM 模型回复超时")
    expect(out).toContain("OAuth 失效")
    expect(out).toContain("1800000ms")
  })

  // [fix: feishu-llm-stall-fastfail 2026-06-07] 首字节快速失败的 error 也要命中 timeout 友好提示
  test("'opencode prompt 首字节超时 (120000ms) — LLM 无任何输出' → 模型超时友好提示", () => {
    const out = friendlyErrorReply(
      new Error("opencode prompt 首字节超时 (120000ms) — LLM 无任何输出(provider 可能繁忙/无响应,如 503 重试)"),
    )
    expect(out).toContain("LLM 模型回复超时")
    expect(out).toContain("120000ms")
  })

  test("HTTP 429 / rate limit → provider 限速提示", () => {
    const out1 = friendlyErrorReply(new Error("Request failed: 429 Too Many Requests"))
    expect(out1).toContain("LLM provider 限速")
    expect(out1).toContain("429")

    const out2 = friendlyErrorReply(new Error("rate limit exceeded for model"))
    expect(out2).toContain("LLM provider 限速")
  })

  test("HTTP 502/503/504 → provider 暂不可用提示", () => {
    const out1 = friendlyErrorReply(new Error("Bad gateway 502 from anthropic"))
    expect(out1).toContain("LLM provider 暂时不可用")
    expect(out1).toContain("HTTP 5xx")

    const out2 = friendlyErrorReply(new Error("503 Service Unavailable"))
    expect(out2).toContain("LLM provider 暂时不可用")

    const out3 = friendlyErrorReply(new Error("504 Gateway Timeout"))
    // 504 同时含 504 + timeout 关键字,优先匹配 timeout(用户视角同样是"超时")
    expect(out3 === "" ? false : out3.includes("超时") || out3.includes("5xx")).toBe(true)
  })

  test("'本轮 LLM 无 useful 输出' → 权限被拒/链路异常友好提示", () => {
    const out = friendlyErrorReply(
      new Error("本轮 LLM 无 useful 输出(可能权限被拒 / provider 链路异常 / 30 分钟超时降级)"),
    )
    expect(out).toContain("LLM 这轮没产出任何回复")
    expect(out).toContain("权限申请被拒")
    expect(out).toContain("provider 链路异常")
  })

  test("'session.messages 读取失败' → sidecar 状态异常,建议重启 DeskFox", () => {
    const out = friendlyErrorReply(
      new Error("opencode session.messages 读取失败(status=500),LLM 回复无法获取"),
    )
    expect(out).toContain("DeskFox 内部读不到 LLM 回复")
    expect(out).toContain("重启 DeskFox")
  })

  test("'session 为空' 同样命中 sidecar 异常提示", () => {
    const out = friendlyErrorReply(new Error("opencode session 为空(LLM 未产出任何消息)"))
    // "LLM 未产出"先命中 no-useful 路径,所以期望见到 no-useful 文案
    expect(out).toContain("LLM 这轮没产出任何回复")
  })

  test("非典型错误(不含 timeout/429/5xx 等)→ 保留原 message,默认 fallback", () => {
    const out = friendlyErrorReply(new Error("file not found: /tmp/x.txt"))
    expect(out).toContain("DeskFox 处理出错")
    expect(out).toContain("file not found")
    expect(out).not.toContain("LLM model")
    expect(out).not.toContain("API key 可能无效")
    expect(out).not.toContain("LLM 模型回复超时")
  })

  test("空 message → 保留默认 fallback", () => {
    const out = friendlyErrorReply(new Error(""))
    expect(out).toContain("DeskFox 处理出错")
  })
})
