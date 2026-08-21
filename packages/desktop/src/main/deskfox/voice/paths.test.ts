// [fork-only] REQ-102 语音派活 — 仓根/wrapper 路径解析单测 [feat: voice-dispatch-minimal] 2026-08-21
import { describe, expect, test } from "bun:test"
import { looksLikeForkRepo, resolveVoiceRepoRoot, resolveWrapperPath } from "./paths"

const ENTRY = "packages/opencode/src/index.ts"
const forkAt = (root: string) => (p: string) => p === `${root}/${ENTRY}`

describe("resolveVoiceRepoRoot", () => {
  test("env 显式指定且确实是 fork 仓 → 用它", () => {
    expect(
      resolveVoiceRepoRoot({ env: { DESKFOX_VOICE_REPO_ROOT: "/fork" }, packaged: false, exists: forkAt("/fork") }),
    ).toBe("/fork")
  })

  test("env 指了个不是 fork 仓的目录 → 不认(免得起一个跑不通的宿主)", () => {
    expect(
      resolveVoiceRepoRoot({ env: { DESKFOX_VOICE_REPO_ROOT: "/nope" }, packaged: false, exists: () => false }),
    ).toBe("")
  })

  test("开发态从 out/main 上溯到仓根", () => {
    expect(
      resolveVoiceRepoRoot({
        env: {},
        packaged: false,
        mainDir: "/fork/packages/desktop/out/main",
        exists: forkAt("/fork"),
      }),
    ).toBe("/fork")
  })

  // R5:装好的 app 依赖本机源码树 —— 没有就老实返回空,让入口禁用并说明,而不是静默失败
  test("打包态没有源码树 → 返回空", () => {
    expect(resolveVoiceRepoRoot({ env: {}, packaged: true, exists: () => true })).toBe("")
  })

  test("打包态但 env 显式指了源码树 → 仍然可用(power user 逃生阀)", () => {
    expect(
      resolveVoiceRepoRoot({ env: { DESKFOX_VOICE_REPO_ROOT: "/fork" }, packaged: true, exists: forkAt("/fork") }),
    ).toBe("/fork")
  })
})

test("looksLikeForkRepo 认的是 1.x ACP 入口,不是随便一个目录", () => {
  expect(looksLikeForkRepo("/fork", forkAt("/fork"))).toBe(true)
  expect(looksLikeForkRepo("/fork", () => false)).toBe(false)
  expect(looksLikeForkRepo("", () => true)).toBe(false)
})

test("resolveWrapperPath 与仓根同源;仓根为空则为空", () => {
  expect(resolveWrapperPath("/fork")).toBe("/fork/packages/desktop/scripts/deskfox-acp-wrap.mjs")
  expect(resolveWrapperPath("")).toBe("")
})
