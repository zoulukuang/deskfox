// [fork-only] REQ-102 语音派活 — 仓根/wrapper 路径解析单测 [feat: voice-dispatch-minimal] 2026-08-21
import { describe, expect, test } from "bun:test"
import { looksLikeForkRepo, resolveVoiceRepoRoot, resolveWrapperPath, walkUpForForkRepo } from "./paths"

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
  test("打包态且上溯不到源码树(装到 /Applications)→ 返回空", () => {
    expect(
      resolveVoiceRepoRoot({
        env: {},
        packaged: true,
        execPath: "/Applications/DeskFox.app/Contents/MacOS/DeskFox",
        exists: () => false,
      }),
    ).toBe("")
  })

  // 自己打的 local/dev 包就躺在仓里,靠上溯即可开箱可用(2026-08-21 真机验证过这条路)
  test("打包态但 .app 在仓内 → 从可执行文件上溯到仓根", () => {
    const exe = "/fork/packages/desktop/dist-deskfox/mac-arm64/DeskFox 本地版.app/Contents/MacOS/DeskFox 本地版"
    expect(resolveVoiceRepoRoot({ env: {}, packaged: true, execPath: exe, exists: forkAt("/fork") })).toBe("/fork")
  })

  test("上溯有层数上限,不会一路爬到根目录乱认", () => {
    const deep = "/a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/exe"
    expect(walkUpForForkRepo(deep, forkAt("/a"))).toBe("")
  })

  test("打包态但 env 显式指了源码树 → 仍然可用(power user 逃生阀)", () => {
    expect(
      resolveVoiceRepoRoot({
        env: { DESKFOX_VOICE_REPO_ROOT: "/fork" },
        packaged: true,
        execPath: "/Applications/X.app/Contents/MacOS/X",
        exists: forkAt("/fork"),
      }),
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
