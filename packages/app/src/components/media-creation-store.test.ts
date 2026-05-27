// [fork-only] 创作卡作用域隔离单测 [feat: media-creation-mode]
// [bug-repro: 启动过创作后,打开任何新会话/新绘画都带出旧创作记录(模块级全局 store 未按 session 隔离)]
import { describe, expect, test, beforeEach } from "bun:test"
import { creation, DRAFT_SCOPE } from "./media-creation-store"
import type { MediaModel, MediaResult } from "@/utils/media-creation"

const entry: MediaModel = {
  id: "alibaba-x",
  capability: "image",
  provider: "p",
  model: "m",
  displayName: "测试模型",
}

// mock 生成:立即 resolve(不碰真实本地服务 / 网络)
const fakeGen = async (): Promise<MediaResult> => ({
  kind: "image",
  urls: ["u"],
  localPaths: ["/proj/creations/images/x.png"],
  model: "m",
  provider: "p",
})

beforeEach(() => {
  creation.resetScope(DRAFT_SCOPE)
})

describe("创作卡作用域隔离", () => {
  test("不同 session 作用域的卡互不可见(本 bug 根因)", async () => {
    creation.setScope("sessA")
    creation.resetScope("sessA")
    await creation.runCreation(entry, { prompt: "p" }, undefined, { generate: fakeGen })
    expect(creation.cards().length).toBe(1)
    expect(creation.cards()[0]?.status).toBe("done")

    creation.setScope("sessB")
    creation.resetScope("sessB")
    expect(creation.cards().length).toBe(0) // B 看不到 A 的卡

    creation.setScope("sessA")
    expect(creation.cards().length).toBe(1) // 切回 A 仍在
  })

  test("resetScope 清空当前作用域(新建会话进 draft)", async () => {
    creation.setScope("sessC")
    creation.resetScope("sessC")
    await creation.runCreation(entry, { prompt: "p" }, undefined, { generate: fakeGen })
    expect(creation.cards().length).toBe(1)
    creation.resetScope("sessC")
    expect(creation.cards().length).toBe(0)
  })

  // [bug-repro: 已停在首页时再点"新建会话"(home→home,同路由 params.id 不变 → session.tsx effect
  //  不触发)→ 旧 draft 卡不清。各新建会话入口显式调 resetDraft() 兜底]
  test("resetDraft 清空首页 draft(home→home 新建会话路径)", async () => {
    creation.setScope(DRAFT_SCOPE)
    creation.resetScope(DRAFT_SCOPE)
    await creation.runCreation(entry, { prompt: "首页生成" }, undefined, { generate: fakeGen })
    expect(creation.cards().length).toBe(1) // 首页 draft 有卡
    creation.resetDraft() // 模拟点"新建会话"
    expect(creation.cards().length).toBe(0) // draft 清空
  })

  test("adoptDraftInto:首页 draft 卡过继给新建 session,draft 清空", async () => {
    creation.setScope(DRAFT_SCOPE)
    creation.resetScope(DRAFT_SCOPE)
    await creation.runCreation(entry, { prompt: "p" }, undefined, { generate: fakeGen })
    expect(creation.cards().length).toBe(1) // draft 有 1 张

    creation.adoptDraftInto("newSess")
    creation.setScope(DRAFT_SCOPE)
    expect(creation.cards().length).toBe(0) // draft 已清空
    creation.setScope("newSess")
    expect(creation.cards().length).toBe(1) // 过继到新 session
  })

  // [bug-repro: 视频生成完成但卡片卡在"正在生成…"—— 生成期间发 chat,adoptDraftInto 把运行中的卡
  //  从 draft 移到新 session,而 patch 用启动时捕获的固定 scope 找不到 → 卡永不更新]
  test("生成中途卡被 adopt 到新 session,完成后仍能更新为 done(不卡 running)", async () => {
    creation.setScope(DRAFT_SCOPE)
    creation.resetScope(DRAFT_SCOPE)
    creation.resetScope("sessVideo")

    // 可控 resolve 的 generate,模拟视频长耗时
    let resolveGen!: (r: MediaResult) => void
    const slowGen = () => new Promise<MediaResult>((res) => (resolveGen = res))
    const run = creation.runCreation(entry, { prompt: "视频" }, undefined, { generate: slowGen })

    // 生成中:卡在 draft,running
    expect(creation.cards()[0]?.status).toBe("running")

    // 模拟发 chat 建出 session → adopt + 切作用域(卡从 draft 移到 sessVideo)
    creation.adoptDraftInto("sessVideo")
    creation.setScope("sessVideo")
    expect(creation.cards().length).toBe(1)

    // 生成完成 → patch 必须跨作用域找到这张卡并置 done
    resolveGen({ kind: "video", url: "u", localPaths: ["/p/creations/videos/x.mp4"], model: "m", provider: "p" })
    await run
    expect(creation.cards()[0]?.status).toBe("done")
    expect(creation.cards()[0]?.result?.kind).toBe("video")
  })
})
