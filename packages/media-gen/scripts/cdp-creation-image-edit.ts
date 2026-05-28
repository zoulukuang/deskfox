// [fork-only] CDP 真用户操作 e2e:fix/creation-edit-asr-no-file
//   流程:清编辑器 → 切创作模式 → 点编辑器 → @ 触发 popover → 续打过滤 → 回车选中 → 续打提示词 → 回车提交
//   fetch 拦截 /generate body(不真发阿里 API),最后断言 input.refFile 真填上、prompt 剥除 @ 字面。
// 前提:DeskFox 9222 启动 + 项目里有 creations/ 文件

const CDP = "http://127.0.0.1:9222"
const tabs = (await (await fetch(`${CDP}/json/list`)).json()) as Array<{ type: string; title: string; url: string; webSocketDebuggerUrl: string }>
const page = tabs.find((t) => t.type === "page" && t.title === "DeskFox")
if (!page) { console.error("✗ 没找到 DeskFox 页面"); process.exit(1) }
console.log("→ page:", page.url)

const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map<number, (m: { result?: { result?: { value?: unknown }; exceptionDetails?: unknown } }) => void>()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data as string)
  if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id) }
}
const send = (method: string, params: Record<string, unknown> = {}) =>
  new Promise<{ result?: { result?: { value?: unknown }; exceptionDetails?: unknown } }>((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
await new Promise<void>((r) => (ws.onopen = () => r()))
await send("Runtime.enable")

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
async function evaluate<T = unknown>(expr: string): Promise<T> {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) { console.log("    [EXC]", JSON.stringify(r.result.exceptionDetails).slice(0, 200)); return undefined as T }
  return r.result?.result?.value as T
}
async function clickAt(x: number, y: number) {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y })
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 })
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 })
}
async function typeText(text: string) {
  for (const ch of text) {
    await send("Input.dispatchKeyEvent", { type: "keyDown", text: ch, key: ch })
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: ch })
    await sleep(30)
  }
}
async function pressKey(name: string, code: string, vk: number) {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: name, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
}

// ====== STEP 0:fetch 拦截 + 清编辑器 ======
console.log("\n[0a] 装 fetch 拦截(/generate POST → 捕获 body,假装 SSE error 不真发)…")
await evaluate(`(() => {
  if (window.__capturedBodies) { window.__capturedBodies = []; return "reset" }
  window.__capturedBodies = []
  const orig = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input?.url || String(input))
    if (/\\/generate$/.test(url)) {
      let body = init?.body
      if (typeof body !== "string" && body) { try { body = await new Response(body).text() } catch {} }
      window.__capturedBodies.push({ url, body: String(body) })
      const sse = new ReadableStream({ start(c) {
        c.enqueue(new TextEncoder().encode('event: error\\ndata: {"message":"[CDP-INTERCEPTED]"}\\n\\n'))
        c.close()
      }})
      return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } })
    }
    return orig(input, init)
  }
  return "installed"
})()`).then((v) => console.log("    →", v))

console.log("[0b] 清空编辑器(focus + Ctrl+A + Delete)…")
await evaluate(`(() => {
  const ed = [...document.querySelectorAll('[contenteditable]')].find(e => e.getBoundingClientRect().width > 200)
  if (ed) { ed.focus(); }
  return !!ed
})()`)
// Ctrl+A 全选 + Delete
await send("Input.dispatchKeyEvent", { type: "keyDown", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65 })
await send("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65 })
await sleep(80)
await pressKey("Delete", "Delete", 46)
await sleep(150)
console.log("    清空后编辑器内容:", JSON.stringify(await evaluate(`document.querySelector('[contenteditable]')?.textContent`)))

// ====== STEP 1:确认/切换创作模式到「图片编辑」======
const currentMode = await evaluate<string>(`document.querySelector('[data-action="media-mode"]')?.textContent?.trim()`)
console.log(`\n[1] 当前模式: ${currentMode}`)
if (currentMode !== "图片编辑") {
  const trig = await evaluate<{ x: number; y: number } | null>(`(() => { const el = document.querySelector('[data-action="media-mode"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) } })()`)
  if (trig) { await clickAt(trig.x, trig.y); await sleep(500) }
  const item = await evaluate<{ x: number; y: number } | null>(`(() => { const el = [...document.querySelectorAll('[data-slot="select-select-item"]')].find(e => /图片编辑/.test(e.textContent ?? '')); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) } })()`)
  if (item) { await clickAt(item.x, item.y); await sleep(500) }
  console.log("    切换后:", await evaluate(`document.querySelector('[data-action="media-mode"]')?.textContent?.trim()`))
}

// ====== STEP 2:点编辑器 + 打 @ ======
console.log("\n[2] 点 chat prompt 编辑器 (y≈984, w>200) + 打 @…")
const ed = await evaluate<{ x: number; y: number } | null>(`(() => {
  const e = [...document.querySelectorAll('[contenteditable]')].find(x => x.getBoundingClientRect().width > 200)
  if (!e) return null
  const r = e.getBoundingClientRect()
  return { x: Math.round(r.x + 40), y: Math.round(r.y + r.height/2) }
})()`)
if (!ed) { console.error("✗ 没找到 chat editor"); ws.close(); process.exit(1) }
await clickAt(ed.x, ed.y)
await sleep(250)
await typeText("@")
await sleep(500)

// ====== STEP 3:看 popover 是否弹 + 列项 ======
const popState = await evaluate<{ open: boolean; itemCount: number; items: string[] }>(`(() => {
  const pops = [...document.querySelectorAll('div.bg-surface-raised-stronger-non-alpha')].filter(e => e.offsetParent !== null)
  if (pops.length === 0) return { open: false, itemCount: 0, items: [] }
  const items = [...pops[0].querySelectorAll('button')]
  return { open: true, itemCount: items.length, items: items.slice(0, 8).map(b => (b.textContent ?? '').trim()) }
})()`)
console.log("    @ 后 popover 状态:", JSON.stringify(popState, null, 2))

// ====== STEP 4:续打 creations/ 让 popover 过滤到具体文件 ======
console.log("\n[3] 续打「creations/」过滤到 creations 目录…")
await typeText("creations/")
await sleep(700)

const filtered = await evaluate<{ items: Array<{ text: string; x: number; y: number }> }>(`(() => {
  const pops = [...document.querySelectorAll('div.bg-surface-raised-stronger-non-alpha')].filter(e => e.offsetParent !== null)
  if (pops.length === 0) return { items: [] }
  return {
    items: [...pops[0].querySelectorAll('button')].map(b => {
      const r = b.getBoundingClientRect()
      return { text: (b.textContent ?? '').trim().slice(0, 80), x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }
    })
  }
})()`)
console.log("    过滤后 popover 选项:")
for (const it of filtered.items.slice(0, 8)) console.log("      •", it.text)

if (filtered.items.length === 0) {
  console.error("✗ popover 里没匹配项 — 项目里 creations/ 可能没文件,或 popover 关了")
  ws.close()
  process.exit(1)
}

// ====== STEP 5:点第一个匹配项(插入 file part)======
console.log("\n[4] 点第一个匹配项:", filtered.items[0]!.text)
await clickAt(filtered.items[0]!.x, filtered.items[0]!.y)
await sleep(500)
const afterPick = await evaluate<string>(`document.querySelector('[contenteditable]')?.textContent?.slice(0, 120)`)
console.log("    编辑器内容:", JSON.stringify(afterPick))

// ====== STEP 6:续打提示词 ======
console.log("\n[5] 续打提示词 + 回车提交…")
await typeText(" 加个红色斗篷")
await sleep(200)
const beforeSubmit = await evaluate<string>(`document.querySelector('[contenteditable]')?.textContent?.slice(0, 120)`)
console.log("    提交前编辑器内容:", JSON.stringify(beforeSubmit))

await pressKey("Enter", "Enter", 13)
console.log("    → 已按回车,等捕获 /generate body…")

// ====== STEP 7:轮询捕获 body ======
let captured: Array<{ url: string; body: string }> = []
for (let i = 0; i < 20; i++) {
  await sleep(300)
  const c = await evaluate<Array<{ url: string; body: string }>>(`window.__capturedBodies || []`)
  if (Array.isArray(c) && c.length > 0) { captured = c; break }
}

console.log("\n[6] 捕获结果:")
if (captured.length === 0) {
  console.log("    ❌ 没捕获到 /generate POST — 提交流没走通")
  ws.close()
  process.exit(1)
}

const body = captured[0]!.body
console.log("    captured.body =", body.length > 400 ? body.slice(0, 400) + "..." : body)

try {
  const parsed = JSON.parse(body)
  const refFile = parsed?.input?.refFile
  const prompt = parsed?.input?.prompt
  console.log("\n=== 验证 ===")
  console.log("  input.refFile     :", JSON.stringify(refFile))
  console.log("  input.prompt      :", JSON.stringify(prompt))
  console.log("  prompt 含 @ 字面?:", typeof prompt === "string" && prompt.includes("@"))
  console.log("  refFile 是绝对路径?:", typeof refFile === "string" && (/^[A-Za-z]:[\\\/]/.test(refFile) || refFile.startsWith("/")))

  const okRef = typeof refFile === "string" && refFile.length > 0
  const okPrompt = typeof prompt === "string" && !prompt.includes("@")
  const okAbs = typeof refFile === "string" && (/^[A-Za-z]:[\\\/]/.test(refFile) || refFile.startsWith("/"))
  if (okRef && okPrompt && okAbs) {
    console.log("\n🎉 修复真实生效:refFile 填入绝对路径,prompt 剥除 @ 字面")
    ws.close()
    process.exit(0)
  } else {
    console.log("\n❌ 验证失败")
    ws.close()
    process.exit(1)
  }
} catch (e) {
  console.log("    解析 body 失败:", (e as Error).message)
  ws.close()
  process.exit(1)
}
