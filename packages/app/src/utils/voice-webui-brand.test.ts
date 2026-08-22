// FORK-ONLY test: REQ-102 语音 WebUI 品牌化注入脚本的 DOM 行为 [feat: voice-dispatch-minimal] 2026-08-22
//
// ⚠️ 被测代码在 `packages/branding/voice-webui/deskfox-brand.js`,不在本包。
// 放这里是因为 happy-dom 环境在 app 包(`bunfig.toml` 的 preload),而 desktop 包没有 ——
// 给 desktop 加这个 devDependency 会动 `bun.lock`,那是黑名单文件,不值得为一个测试花 override 配额。
//
// 为什么这个脚本必须有测试:它跑在 qwen 的页面里、**按文案匹配**改 DOM
// (类名是带 hash 的构建产物,升级即变,只能认文案)。qwen 改一次界面文案就可能失效,
// 得有东西盯着 —— 而"渲染出来好不好看"测不了,"该改的元素认没认出来"是可测的。
import { describe, expect, test, beforeAll } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const SCRIPT = path.join(import.meta.dir, "..", "..", "..", "branding", "voice-webui", "deskfox-brand.js")

// 照着 2026-08-22 真机截图搭最小版结构:顶栏(头像/名字/副标题/技术标签/状态/按钮)+ 主区
const PAGE = `
<div id="root">
  <header>
    <div class="avatar">V</div>
    <div><div class="name">qwen-audio-agent</div></div>
    <div class="tag">REALTIME VOICE · LIVE</div>
    <div><span class="backend">OpenCode</span></div>
    <div><span class="model">Qwen Audio 3.0 Realtime Plus</span></div>
    <div><span class="cap-a">模型支持: 文字 / 语音</span></div>
    <div><span class="cap-b">Web 传输: 文字 / 语音</span></div>
    <div class="status">待命</div>
    <button>新会话</button>
    <button>开启麦克风</button>
  </header>
  <main>
    <div class="eyebrow">VOICE FRONTEND</div>
    <h1>你说，我来调度。</h1>
  </main>
</div>
`

const text = (sel: string) => document.querySelector(sel)?.textContent?.trim() ?? ""
const isHidden = (sel: string) => {
  const el = document.querySelector(sel) as HTMLElement | null
  if (!el) return false
  return el.style.display === "none" || el.closest("[data-deskfox-hidden]") !== null
}

describe("语音 WebUI 品牌化注入", () => {
  beforeAll(async () => {
    document.body.innerHTML = PAGE
    new Function(readFileSync(SCRIPT, "utf8"))() // 脚本是 IIFE,求值即施加
    await new Promise((r) => setTimeout(r, 50))
  })

  test("品牌名替换掉 qwen-audio-agent", () => {
    expect(text(".name")).toBe("小狐狸投研助手")
  })

  test("主标题换成 user 定的 slogan", () => {
    expect(text("h1")).toBe("小狐狸投研")
  })

  test("页面标题也换 —— 浏览器标签页上就是品牌", () => {
    expect(document.title).toBe("小狐狸投研助手")
  })

  // user 原话:「其他的图标描述(比如"千问"等)都去掉,包括"open code"」
  test("第三方标识与技术标签全部隐藏", () => {
    expect(isHidden(".backend")).toBe(true) // OpenCode
    expect(isHidden(".model")).toBe(true) // Qwen Audio 3.0 Realtime Plus
    expect(isHidden(".tag")).toBe(true) // REALTIME VOICE · LIVE
    expect(isHidden(".eyebrow")).toBe(true) // VOICE FRONTEND
    expect(isHidden(".cap-a")).toBe(true) // 模型支持
    expect(isHidden(".cap-b")).toBe(true) // Web 传输
  })

  // 状态和按钮是功能信息 —— 藏了用户就不知道它在不在听、也没法操作
  test("状态与操作按钮必须留着", () => {
    expect(isHidden(".status")).toBe(false)
    expect(text(".status")).toBe("待命")
    expect(document.querySelectorAll("button").length).toBe(2)
  })

  test("顶栏头像换成狐狸 logo", () => {
    const avatar = document.querySelector(".avatar") as HTMLElement
    expect(avatar.dataset.deskfoxLogo).toBe("1")
    expect(avatar.textContent).toBe("")
    expect(avatar.style.backgroundImage).toContain("/skins/deskfox/logo.png")
  })

  test("补一行自己的副标题(顶掉被隐藏的 REALTIME VOICE)", () => {
    expect(text(".deskfox-subtitle")).toBe("DeskFox · 语音助手")
  })
})
