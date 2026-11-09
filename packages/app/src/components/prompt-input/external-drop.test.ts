// [fork-only] 外部拖入路由 [feat: external-drop-path-ref] 2026-08-14
//
// 这段逻辑 **e2e 原理上覆盖不到**:系统级拖放不经过 renderer,CDP 的 dispatchDragEvent
// 只能模拟页面内拖拽。所以路由规则只能靠单测钉死 —— 用例编号对应 1-spec.md §五。
import { describe, expect, test } from "bun:test"

import { isImageDrop, rejectionToastKind, routeExternalDrop, shouldBlockAsImage } from "./external-drop"
import { toMentionPath } from "./multi-path-drop"

describe("外部拖入路由(routeExternalDrop)", () => {
  test("L1 图片有路径 → 仍走内联(图片不改道,视觉要字节)", () => {
    for (const [type, name] of [
      ["image/png", "a.png"],
      ["image/jpeg", "b.jpg"],
      ["image/gif", "c.gif"],
      ["image/webp", "d.webp"],
    ] as const) {
      expect(routeExternalDrop({ type, name, path: "/tmp/" + name })).toEqual({ kind: "inline" })
    }
  })

  test("L2 图片无路径(粘贴截图)→ 内联", () => {
    expect(routeExternalDrop({ type: "image/png", name: "screenshot.png" })).toEqual({ kind: "inline" })
  })

  test("L3 .docx 有路径 → 路径引用(此前会被二进制嗅探拒掉)", () => {
    expect(
      routeExternalDrop({
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        name: "报告.docx",
        path: "/Users/me/Documents/报告.docx",
      }),
    ).toEqual({ kind: "path", path: "/Users/me/Documents/报告.docx" })
  })

  test("L4 .csv 有路径 → 路径引用(**行为变化**:此前是内联)", () => {
    expect(routeExternalDrop({ type: "text/csv", name: "data.csv", path: "/tmp/data.csv" })).toEqual({
      kind: "path",
      path: "/tmp/data.csv",
    })
  })

  test("L5 任意二进制有路径 → 路径引用,不再被拒", () => {
    for (const [type, name] of [
      ["application/zip", "x.zip"],
      ["video/mp4", "y.mp4"],
      ["", "unknown.bin"],
    ] as const) {
      expect(routeExternalDrop({ type, name, path: "/tmp/" + name })).toEqual({
        kind: "path",
        path: "/tmp/" + name,
      })
    }
  })

  test("L6 任意类型无路径 → 内联(回落原行为)", () => {
    // 浏览器拖来的虚拟文件 / 剪贴板都没有真实路径,这条不能回归
    expect(routeExternalDrop({ type: "application/pdf", name: "z.pdf" })).toEqual({ kind: "inline" })
    expect(routeExternalDrop({ type: "text/plain", name: "z.txt" })).toEqual({ kind: "inline" })
  })

  test("L7 mime 为空但扩展名是大写 .PNG → 认作图片 → 内联", () => {
    expect(routeExternalDrop({ type: "", name: "SHOT.PNG", path: "/tmp/SHOT.PNG" })).toEqual({
      kind: "inline",
    })
  })

  test("L8 路径为空串/纯空白 → 视作无路径 → 内联(不许产出空路径引用)", () => {
    expect(routeExternalDrop({ type: "text/plain", name: "a.txt", path: "" })).toEqual({ kind: "inline" })
    expect(routeExternalDrop({ type: "text/plain", name: "a.txt", path: "   " })).toEqual({ kind: "inline" })
  })

  test("mime 带参数(charset)也要认出图片", () => {
    expect(isImageDrop({ type: "image/png; charset=binary", name: "a.png" })).toBe(true)
  })

  test("缺字段不抛错(dataTransfer 给的对象未必完整)", () => {
    expect(routeExternalDrop({})).toEqual({ kind: "inline" })
    expect(isImageDrop({})).toBe(false)
  })
})

// [bug-repro: 模型不支持图片时,`isImageBlocked` 拦截**对所有附件生效**而非只图片 ——
//   连 .txt / .csv 也被拦下并弹「模型不支持图片」。此前被 attachmentMime 白名单掩盖不易察觉,
//   档一放开外部拖入类型后会立刻暴露。用例编号对应 1-spec.md §五。]
describe("图片能力拦截的作用范围", () => {
  test("R1 非图片附件不该被图片拦截挡下(bug-repro)", () => {
    expect(shouldBlockAsImage("text/plain", true)).toBe(false)
    expect(shouldBlockAsImage("application/pdf", true)).toBe(false)
  })

  test("R2 图片附件仍然被拦(原行为不许回退)", () => {
    expect(shouldBlockAsImage("image/png", true)).toBe(true)
    expect(shouldBlockAsImage("image/jpeg", true)).toBe(true)
  })

  test("R2b 模型支持图片时谁都不拦", () => {
    expect(shouldBlockAsImage("image/png", false)).toBe(false)
    expect(shouldBlockAsImage("text/plain", false)).toBe(false)
  })

  test("R3 一批全是非图片被拒 → 弹通用提示,不弹「模型不支持图片」(bug-repro)", () => {
    expect(rejectionToastKind([{ type: "application/octet-stream", name: "x.bin" }], true)).toBe("unsupported")
  })

  test("R3b 批次里含图片且模型不支持图片 → 才弹图片专属提示", () => {
    expect(rejectionToastKind([{ type: "image/png", name: "a.png" }], true)).toBe("image-unsupported")
    expect(
      rejectionToastKind([{ type: "text/plain", name: "a.txt" }, { type: "image/png", name: "b.png" }], true),
    ).toBe("image-unsupported")
  })

  test("R3c 模型支持图片时,一律通用提示", () => {
    expect(rejectionToastKind([{ type: "image/png", name: "a.png" }], false)).toBe("unsupported")
  })
})

// 外部拖入插进输入框的路径,必须与**文件树拖入**产出同一种写法。
// [bug-repro: 第一版直接把 getPathForFile 的原始路径插进去 ——
//   ① Windows 上是 `C:\\Users\\…` 反斜杠原样(既有 helper 明确把「路径含 Win 反斜杠」列为
//      要容错的边界,说明 @-mention 不吃反斜杠);
//   ② 拖一个**本来就在项目里**的文件时给绝对路径,而文件树拖同一文件给相对路径,
//      同一个文件出现两种引用写法。
//   两条都在 Mac 上就该测出来 —— 我只想着「能不能拖进来」,没想到「插进去的路径对不对」。]
describe("拖入路径归一化(与文件树拖入保持同一种写法)", () => {
  test("W1 Windows 绝对路径 → 反斜杠归一化为正斜杠", () => {
    expect(toMentionPath("C:\\Users\\me\\Documents\\a.docx", undefined)).toBe(
      "C:/Users/me/Documents/a.docx",
    )
  })

  test("W2 Windows 路径在项目根下 → 转相对(且不带反斜杠)", () => {
    expect(toMentionPath("C:\\proj\\src\\a.ts", "C:\\proj")).toBe("src/a.ts")
  })

  test("W3 posix 路径在项目根下 → 转相对(与文件树拖入一致)", () => {
    expect(toMentionPath("/Volumes/ExtSSD/deskfox-uitest/code/a.py", "/Volumes/ExtSSD/deskfox-uitest")).toBe(
      "code/a.py",
    )
  })

  test("W4 项目外的路径 → 原样保留绝对路径(模型需要完整路径才读得到)", () => {
    expect(toMentionPath("/Users/me/Downloads/x.docx", "/Volumes/ExtSSD/deskfox-uitest")).toBe(
      "/Users/me/Downloads/x.docx",
    )
  })

  test("W5 跨盘符(Windows 常见:项目在 D:,文件在 C:)→ 原样绝对路径", () => {
    expect(toMentionPath("C:\\Users\\me\\x.docx", "D:\\proj")).toBe("C:/Users/me/x.docx")
  })
})
