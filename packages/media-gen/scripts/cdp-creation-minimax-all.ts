// [fork-only] CDP 真用户 e2e — MiniMax 三能力路由验证(image / tts / video)
// [feat: media-gen-minimax] 2026-05-28
//
// 每个 case:切模式 → 选 MiniMax 模型 → 提交 → 拦 /generate body 验 entryId
// 不真打阿里 / 不真打 MiniMax(intercept 把所有 /generate 短路 SSE error 假回应)

const CDP = "http://127.0.0.1:9222"
const tabs = (await (await fetch(`${CDP}/json/list`)).json()) as Array<{ type: string; title: string; url: string; webSocketDebuggerUrl: string }>
const page = tabs.find((t) => t.type === "page" && t.title === "DeskFox")!
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map<number, (m: any) => void>()
ws.onmessage = (e) => { const m = JSON.parse(e.data as string); if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id) } }
const send = (method: string, params: any = {}) => new Promise<any>((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
await new Promise<void>((r) => (ws.onopen = () => r()))
await send("Runtime.enable")

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const evaluate = async (expr: string) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })
  return r.result?.result?.value
}
const clickAt = async (x: number, y: number) => {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y })
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 })
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 })
}
const typeText = async (text: string) => {
  for (const ch of text) {
    await send("Input.dispatchKeyEvent", { type: "keyDown", text: ch, key: ch })
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: ch })
    await sleep(25)
  }
}
const pressEnter = async () => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 })
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 })
}

// 全局装一次 fetch 拦截器(三个 case 共用)
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

async function clearEditorAndSwitchMode(modeName: string): Promise<boolean> {
  // 清编辑器
  await evaluate(`(() => { const ed = [...document.querySelectorAll('[contenteditable]')].find(e => e.getBoundingClientRect().width > 200); if (ed) ed.focus() })()`)
  await send("Input.dispatchKeyEvent", { type: "keyDown", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65 })
  await send("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65 })
  await sleep(60)
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 })
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 })
  await sleep(120)
  // 切模式(最多 3 次重试)
  for (let attempt = 1; attempt <= 3; attempt++) {
    const trig = await evaluate(`(() => { const el = document.querySelector('[data-action="media-mode"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2) } })()`) as any
    if (trig) { await clickAt(trig.x, trig.y); await sleep(450) }
    const item = await evaluate(`(() => { const el = [...document.querySelectorAll('[data-slot="select-select-item"]')].find(e => /${modeName}/.test(e.textContent ?? '')); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2) } })()`) as any
    if (item) { await clickAt(item.x, item.y); await sleep(500) }
    const now = await evaluate(`document.querySelector('[data-action="media-mode"]')?.textContent?.trim()`)
    if (now === modeName) return true
  }
  return false
}

async function selectModel(modelRegex: RegExp): Promise<string | null> {
  const trig = await evaluate(`(() => { const el = document.querySelector('[data-action="media-model"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2) } })()`) as any
  if (!trig) return null
  await clickAt(trig.x, trig.y)
  await sleep(450)
  const opts = await evaluate(`(() => [...document.querySelectorAll('[data-slot="select-select-item"]')].map(e => { const r = e.getBoundingClientRect(); return { text: (e.textContent ?? '').trim(), x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2) } }))()`) as Array<{ text: string; x: number; y: number }>
  const match = opts.find((o) => modelRegex.test(o.text))
  if (!match) return null
  await clickAt(match.x, match.y)
  await sleep(500)
  return match.text
}

async function submitAndCapture(promptText: string): Promise<any> {
  // 清掉上一轮捕获
  await evaluate(`window.__capturedBodies = []`)
  // 点编辑器 + 打字
  const ed = await evaluate(`(() => { const e = [...document.querySelectorAll('[contenteditable]')].find(x => x.getBoundingClientRect().width > 200); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x+40), y: Math.round(r.y+r.height/2) } })()`) as any
  await clickAt(ed.x, ed.y)
  await sleep(180)
  await typeText(promptText)
  await sleep(200)
  await pressEnter()
  // 等捕获
  for (let i = 0; i < 20; i++) {
    await sleep(300)
    const c = await evaluate(`window.__capturedBodies || []`) as any[]
    if (c.length > 0) return JSON.parse(c[0].body)
  }
  return null
}

// ====== 跑三个 case ======
const cases: Array<{ name: string; mode: string; modelRegex: RegExp; expectEntryId: string; prompt: string }> = [
  { name: "文生图 → minimax-image-01", mode: "文生图", modelRegex: /^image-01$/, expectEntryId: "minimax-image-01", prompt: "一只赛博朋克小狐狸" },
  { name: "语音合成 → minimax-speech-02-turbo", mode: "语音合成", modelRegex: /^speech-02-turbo$/, expectEntryId: "minimax-speech-02-turbo", prompt: "你好,我是小狐狸" },
  { name: "文生视频 → minimax-hailuo-02", mode: "文生视频", modelRegex: /MiniMax-Hailuo-02/, expectEntryId: "minimax-hailuo-02", prompt: "一只狐狸在霓虹城市奔跑" },
]

let pass = 0
let fail = 0
for (const c of cases) {
  console.log(`\n========== ${c.name} ==========`)
  const switched = await clearEditorAndSwitchMode(c.mode)
  if (!switched) { console.log(`  ✗ 切不到模式 "${c.mode}"`); fail++; continue }
  console.log(`  ✓ 模式: ${c.mode}`)
  const selected = await selectModel(c.modelRegex)
  if (!selected) { console.log(`  ✗ 模型下拉里没匹配 ${c.modelRegex}`); fail++; continue }
  console.log(`  ✓ 选中模型: ${selected}`)
  const body = await submitAndCapture(c.prompt)
  if (!body) { console.log("  ✗ 没捕获到 /generate body"); fail++; continue }
  console.log(`  捕获 body: ${JSON.stringify(body)}`)
  if (body.entryId === c.expectEntryId) {
    console.log(`  ✅ entryId 命中 "${c.expectEntryId}" — dispatch 路由到 MiniMax`)
    pass++
  } else {
    console.log(`  ❌ entryId 错位:期望 "${c.expectEntryId}",实际 "${body.entryId}"`)
    fail++
  }
}

console.log(`\n========== 汇总 ==========`)
console.log(`通过: ${pass} / ${cases.length}`)
console.log(`失败: ${fail}`)
ws.close()
process.exit(fail === 0 ? 0 : 1)
