// [fork-only] REQ-075 md 内链点击拦截共享实现单测 — 聊天区(baseDir=项目根)与文件预览区
// (baseDir=当前文件目录)两组模式;越权/不存在/外链/锚点/修饰键全覆盖。
//   [feat: batch-port-edit-mdlink] 2026-07-07
import { afterEach, describe, expect, test } from "bun:test"
import { createMdLinkClickHandler, type MdLinkToast } from "./md-link-click"

function setup(opts: { root?: string; baseDir?: string; exists?: boolean } = {}) {
  const opened: string[] = []
  const checked: string[] = []
  const toasts: MdLinkToast[] = []
  const handler = createMdLinkClickHandler({
    root: () => opts.root ?? "D:/proj",
    baseDir: () => opts.baseDir ?? opts.root ?? "D:/proj",
    onOpen: (rel) => opened.push(rel),
    checkExists: (_root, rel) => {
      checked.push(rel)
      return (opts.exists ?? true) ? Promise.resolve(1) : Promise.reject(new Error("missing"))
    },
    toast: (t) => toasts.push(t),
  })
  return { handler, opened, checked, toasts }
}

afterEach(() => document.body.replaceChildren())

function makeEvent(href: string | null, mods: Partial<MouseEvent> = {}) {
  const a = document.createElement("a")
  if (href !== null) a.setAttribute("href", href)
  document.body.appendChild(a)
  let prevented = false
  const event = {
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
    target: a,
    preventDefault: () => {
      prevented = true
    },
  } as unknown as MouseEvent
  return { event, wasPrevented: () => prevented }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe("createMdLinkClickHandler(REQ-075)", () => {
  test("U1: http(s)/mailto 外链 → 不拦截(交给 external-link 全局委托)", () => {
    const { handler, opened, toasts } = setup()
    for (const href of ["https://example.com/x", "http://a.b", "mailto:x@y.z"]) {
      const { event, wasPrevented } = makeEvent(href)
      handler(event)
      expect(wasPrevented()).toBe(false)
    }
    expect(opened).toEqual([])
    expect(toasts).toEqual([])
  })

  test("U2: missing anchor never navigates the SPA", () => {
    const { handler, opened } = setup()
    const { event, wasPrevented } = makeEvent("#section-1")
    handler(event)
    expect(wasPrevented()).toBe(true)
    expect(opened).toEqual([])
  })

  test("U3a: 聊天模式(baseDir=项目根)相对链接 → preventDefault + 按根解析开 tab", async () => {
    const { handler, opened, toasts } = setup()
    const { event, wasPrevented } = makeEvent("./需求池/xxx.md")
    handler(event)
    expect(wasPrevented()).toBe(true)
    await flush()
    expect(opened).toEqual(["需求池/xxx.md"])
    expect(toasts).toEqual([])
  })

  test("U3b: 文件预览模式(baseDir=当前文件目录)../ 相对当前文件解析(R1 回归)", async () => {
    const { handler, opened } = setup({ root: "D:/proj", baseDir: "D:/proj/docs/features" })
    const { event, wasPrevented } = makeEvent("../README.md")
    handler(event)
    expect(wasPrevented()).toBe(true)
    await flush()
    expect(opened).toEqual(["docs/README.md"])
  })

  test("U3c: Windows 反斜杠 root 也正确归一(与生产 sdk.directory 形态一致)", async () => {
    const { handler, opened } = setup({ root: "D:\\proj", baseDir: "D:\\proj" })
    const { event } = makeEvent("./a.md")
    handler(event)
    await flush()
    expect(opened).toEqual(["a.md"])
  })

  test("U4: 越权(解析后跳出项目根)→ 越权 toast + preventDefault + 不开 tab(R1 回归)", async () => {
    const { handler, opened, toasts } = setup()
    const { event, wasPrevented } = makeEvent("../../etc/passwd")
    handler(event)
    expect(wasPrevented()).toBe(true)
    await flush()
    expect(opened).toEqual([])
    expect(toasts.length).toBe(1)
    expect(toasts[0].title).toBe("链接超出项目范围")
  })

  test("U5: 目标文件不存在 → 「文件不存在」toast + 不开 tab(R1 回归)", async () => {
    const { handler, opened, toasts } = setup({ exists: false })
    const { event, wasPrevented } = makeEvent("./gone.md")
    handler(event)
    expect(wasPrevented()).toBe(true)
    await flush()
    expect(opened).toEqual([])
    expect(toasts.length).toBe(1)
    expect(toasts[0].title).toBe("文件不存在")
  })

  test("U6: 按住修饰键点击 → 不拦截", () => {
    const { handler, opened } = setup()
    for (const mods of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }]) {
      const { event, wasPrevented } = makeEvent("./a.md", mods)
      handler(event)
      expect(wasPrevented()).toBe(false)
    }
    expect(opened).toEqual([])
  })

  test("root/baseDir 缺失(项目未就绪)→ 不拦截", () => {
    const { handler } = setup({ root: "" })
    const { event, wasPrevented } = makeEvent("./a.md")
    handler(event)
    expect(wasPrevented()).toBe(false)
  })

  test("点击非链接元素 / 无 href → 不处理", () => {
    const { handler } = setup()
    const div = document.createElement("div")
    let prevented = false
    handler({
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      target: div,
      preventDefault: () => (prevented = true),
    } as unknown as MouseEvent)
    expect(prevented).toBe(false)
    const { event, wasPrevented } = makeEvent(null)
    handler(event)
    expect(wasPrevented()).toBe(false)
  })
})

describe("REQ-152 and REQ-146", () => {
  test.each([
    ["./space%20name.md", "space name.md"],
    ["./%E4%B8%AD%E6%96%87.md", "中文.md"],
    ["./literal%2520.md", "literal%20.md"],
    ["./100%.md", "100%.md"],
    ["D:/proj/space%20name.md", "space name.md"],
  ])("decodes exactly once: %s", async (href, path) => {
    const state = setup()
    state.handler(makeEvent(href).event)
    await flush()
    expect(state.checked).toEqual([path])
    expect(state.opened).toEqual([path])
  })

  test("separates the fragment before decoding the path", async () => {
    const state = setup({ baseDir: "D:/proj/docs" })
    state.handler(makeEvent("./guide%23draft.md#%E7%AB%A0%E8%8A%82").event)
    await flush()
    expect(state.checked).toEqual(["docs/guide#draft.md"])
    expect(state.opened).toEqual(["docs/guide#draft.md"])
  })

  test.each(["%2E%2E/%2E%2E/outside.md", "..%2F..%2Foutside.md", "..%5C..%5Coutside.md"])(
    "checks the boundary after decoding %s",
    async (href) => {
      const state = setup()
      const click = makeEvent(href)
      state.handler(click.event)
      await flush()
      expect(click.wasPrevented()).toBe(true)
      expect(state.checked).toEqual([])
      expect(state.opened).toEqual([])
      expect(state.toasts[0]?.title).toBe("链接超出项目范围")
    },
  )

  test.each(["section", "章节", "user-content-section"])("scrolls inside the clicked markdown: %s", (id) => {
    const state = setup()
    const other = document.createElement("div")
    other.setAttribute("data-component", "markdown")
    const scope = other.cloneNode() as HTMLDivElement
    const heading = document.createElement("h2")
    heading.id = id
    const wrongHeading = heading.cloneNode(true) as HTMLHeadingElement
    const scrolled: Element[] = []
    heading.scrollIntoView = () => {
      scrolled.push(heading)
    }
    wrongHeading.scrollIntoView = () => {
      scrolled.push(wrongHeading)
    }
    other.append(wrongHeading)
    const click = makeEvent(`#${encodeURIComponent(id.replace(/^user-content-/, ""))}`)
    scope.append(click.event.target as Node, heading)
    document.body.append(other, scope)
    state.handler(click.event)
    expect(click.wasPrevented()).toBe(true)
    expect(scrolled).toEqual([heading])
  })
})
