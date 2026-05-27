// [fork-only] 创作结果媒体 src 取值单测 [feat: media-creation-mode]
// [bug-repro: 创作模式 TTS 生成完成但卡片音频播放器显示 Error —— 用了远端 OSS url 而非已落盘本地文件]
import { describe, expect, test } from "bun:test"
import { creationMediaSrc } from "./media-creation"

describe("creationMediaSrc", () => {
  const REMOTE = "https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/xxx/audio.wav?Expires=123"
  const LOCAL = "/Users/u/.opencode/imbot-workspace/creations/audio/1779861509476-bepv7.wav"

  test("有本地文件 → 走 localasset(不再用会过期/跨源失败的远端 url)", () => {
    const src = creationMediaSrc(REMOTE, LOCAL)
    // 走自定义 protocol(mac: localasset://localhost / win: http://localasset.localhost)
    expect(src).toContain("localasset")
    // 文件名(percent-encoded)出现在 URL 里,根目录被 base64 编码所以不直接出现
    expect(src).toContain("1779861509476-bepv7.wav")
    // 绝不再指向远端 OSS(本 bug 的根因)
    expect(src).not.toContain("dashscope")
    expect(src).not.toContain("aliyuncs")
  })

  test("无本地文件 → 回落远端 url(刚生成时远端仍可用)", () => {
    expect(creationMediaSrc(REMOTE, undefined)).toBe(REMOTE)
    expect(creationMediaSrc(REMOTE, "")).toBe(REMOTE)
    expect(creationMediaSrc(REMOTE, "   ")).toBe(REMOTE)
  })

  test("远端与本地都无 → 空串(不抛)", () => {
    expect(creationMediaSrc(undefined, undefined)).toBe("")
  })

  test("Windows 反斜杠路径也能正确解析目录/文件名", () => {
    const winLocal = "C:\\Users\\u\\proj\\creations\\audio\\clip.mp3"
    const src = creationMediaSrc(REMOTE, winLocal)
    expect(src).toContain("localasset")
    expect(src).toContain("clip.mp3")
  })
})
