// [fork-only] CDP 真用户操作 e2e:验证 MiniMax 接 provider 后,创作模式真实路由到 minimax engine
// [feat: media-gen-minimax] 2026-05-28
//
// 流程:① 切创作模式 → 文生图 → 左侧模型下拉选「MiniMax·文生图(image-01)」
//      ② 编辑器打 prompt → 回车提交
// fetch 拦截 /generate body,验 entryId === "minimax-image-01"(证明 dispatch 正确路由到 MiniMax,
// 而不是默认走阿里 wanx2.1-t2i-turbo)。
// 前提:DeskFox 9222 启动 + auth.json 含 minimax-cn key

const CDP = "http://127.0.0.1:9222"
const tabs = (await (await fetch(`${CDP}/json/list`)).json()) as Array<{ type: string; title: string; url: string; webSocketDebuggerUrl: string }>
const page = tabs.find((t) => t.type === "page" && t.title === "DeskFox")
if (!page) { console.error("✗ 没找到 DeskFox 页面"); process.exit(1) }
console.log("→ page:", page.url)

const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map<number, (m: { result?: { result?: { value?: unknown }; exceptionDetails?: unknown } }) => void>()
ws.onmessage = (e) => { const m = JSON.parse(e.data as string); if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id) } }
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

// ====== 0:fetch 拦截 + 清编辑器 ======
console.log("\n[0] 装 fetch 拦截 + 清编辑器…")
await evaluate(`(() => {
  window.__capturedBodies = []
  if (!window.__patched) {
    const orig = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : (input?.url || String(input))
      if (/\\/generate$/.test(url)) {
        let body = init?.body
        if (typeof body !== "string" && body) { try { body = await new Response(body).text() } catch {} }
        window.__capturedBodies.push({ url, body: String(body) })
        const sse = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('event: error\\ndata: {"message":"[CDP-INTERCEPTED]"}\\n\\n')); c.close() }})
        return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } })
      }
      return orig(input, init)
    }
    window.__patched = true
  }
  return "ok"
})()`)
await evaluate(`(() => { const ed = [...document.querySelectorAll('[contenteditable]')].find(e => e.getBoundingClientRect().width > 200); if (ed) ed.focus() })()`)
await send("Input.dispatchKeyEvent", { type: "keyDown", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65 })
await send("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65 })
await sleep(80)
await pressKey("Delete", "Delete", 46)
await sleep(150)

// ====== 1:切「文生图」模式 ======
console.log("\n[1] 切创作模式 → 文生图…")
let modeNow = ""
for (let attempt = 1; attempt <= 3; attempt++) {
  const trig = await evaluate<{ x: number; y: number } | null>(`(() => { const el = document.querySelector('[data-action="media-mode"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2) } })()`)
  if (trig) { await clickAt(trig.x, trig.y); await sleep(500) }
  const item = await evaluate<{ x: number; y: number } | null>(`(() => { const el = [...document.querySelectorAll('[data-slot="select-select-item"]')].find(e => /文生图/.test(e.textContent ?? '')); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2) } })()`)
  if (item) { await clickAt(item.x, item.y); await sleep(500) }
  modeNow = (await evaluate<string>(`document.querySelector('[data-action="media-mode"]')?.textContent?.trim()`)) ?? ""
  console.log(`    第 ${attempt} 次,模式: ${modeNow}`)
  if (modeNow === "文生图") break
  await sleep(400)
}
if (modeNow !== "文生图") { console.error("✗ 切不到文生图"); ws.close(); process.exit(1) }

// ====== 2:看左侧模型下拉是否含 MiniMax ======
console.log("\n[2] 打开左侧模型下拉看是否含 MiniMax…")
const modelTrig = await evaluate<{ x: number; y: number; text: string } | null>(`(() => { const el = document.querySelector('[data-action="media-model"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2), text: (el.textContent ?? '').trim() } })()`)
console.log("    左侧模型当前显示:", modelTrig?.text)
if (!modelTrig) { console.error("✗ 没找到模型下拉"); ws.close(); process.exit(1) }
await clickAt(modelTrig.x, modelTrig.y)
await sleep(500)

const models = await evaluate<Array<{ text: string; x: number; y: number }>>(`(() => {
  const opts = [...document.querySelectorAll('[data-slot="select-select-item"]')]
  return opts.map(e => { const r = e.getBoundingClientRect(); return { text: (e.textContent ?? '').trim(), x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2) } })
})()`)
console.log("    可选模型清单:")
for (const m of models) console.log("      •", m.text)

// 模型下拉显示的是 `model` 字段(不是 displayName),所以匹配 minimax 的 model id:
// image-01 / MiniMax-Hailuo-02 / speech-02-turbo
const minimaxModel = models.find((m) => /^image-01$|MiniMax-Hailuo|^speech-02/.test(m.text))
if (!minimaxModel) {
  console.error("✗ 模型下拉里没看到 MiniMax — 可能 minimax-cn key 没配,或 catalog 没 ship 到 build")
  ws.close()
  process.exit(1)
}

// ====== 3:选 MiniMax 模型 ======
console.log("\n[3] 选中:", minimaxModel.text)
await clickAt(minimaxModel.x, minimaxModel.y)
await sleep(500)
const modelAfter = await evaluate<string>(`document.querySelector('[data-action="media-model"]')?.textContent?.trim()`)
console.log("    切换后左侧显示:", modelAfter)

// ====== 4:点编辑器 + 打 prompt + 回车 ======
console.log("\n[4] 点编辑器 + 打 prompt + 回车提交…")
const ed = await evaluate<{ x: number; y: number } | null>(`(() => { const e = [...document.querySelectorAll('[contenteditable]')].find(x => x.getBoundingClientRect().width > 200); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x+40), y: Math.round(r.y+r.height/2) } })()`)
if (!ed) { console.error("✗ 没找到编辑器"); ws.close(); process.exit(1) }
await clickAt(ed.x, ed.y)
await sleep(200)
await typeText("一只赛博朋克风的小狐狸")
await sleep(200)
await pressKey("Enter", "Enter", 13)
console.log("    → 回车已按,等捕获 /generate…")

// ====== 5:捕获并验证 body ======
let captured: Array<{ url: string; body: string }> = []
for (let i = 0; i < 20; i++) {
  await sleep(300)
  const c = await evaluate<Array<{ url: string; body: string }>>(`window.__capturedBodies || []`)
  if (Array.isArray(c) && c.length > 0) { captured = c; break }
}

console.log("\n[5] 捕获结果:")
if (!captured.length) { console.log("    ❌ 没捕获到 /generate POST"); ws.close(); process.exit(1) }
console.log("    body:", captured[0]!.body)

try {
  const parsed = JSON.parse(captured[0]!.body)
  const entryId = parsed?.entryId
  const prompt = parsed?.input?.prompt
  console.log("\n=== 验证 ===")
  console.log("  entryId :", JSON.stringify(entryId))
  console.log("  prompt  :", JSON.stringify(prompt))

  if (entryId === "minimax-image-01") {
    console.log("\n🎉 MiniMax 真实接入成功:entryId=minimax-image-01,创作模式真的路由到 MiniMax 引擎(不是默认阿里)")
    ws.close()
    process.exit(0)
  } else {
    console.log(`\n❌ 验证失败:entryId 期望 "minimax-image-01",实际 "${entryId}"`)
    ws.close()
    process.exit(1)
  }
} catch (e) {
  console.log("    解析 body 失败:", (e as Error).message)
  ws.close()
  process.exit(1)
}
