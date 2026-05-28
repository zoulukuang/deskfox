// [fork-only] CDP 真用户操作 e2e:fix/creation-edit-asr-no-file — ASR(语音识别)路径
//   流程:清编辑器 → 切「语音识别」→ @creations/audio/ → 选第一项 → 回车提交
//   拦 /generate body 验 input.audioUrl 真填(不是 refFile),prompt 剥 @ 字面。

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

// ====== 1:切「语音识别」(带重试)======
console.log("\n[1] 切创作模式 → 语音识别…")
let modeNow = ""
for (let attempt = 1; attempt <= 3; attempt++) {
  const trig = await evaluate<{ x: number; y: number } | null>(`(() => { const el = document.querySelector('[data-action="media-mode"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) } })()`)
  if (trig) { await clickAt(trig.x, trig.y); await sleep(600) }
  const item = await evaluate<{ x: number; y: number } | null>(`(() => { const el = [...document.querySelectorAll('[data-slot="select-select-item"]')].find(e => /语音识别/.test(e.textContent ?? '')); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) } })()`)
  if (item) { await clickAt(item.x, item.y); await sleep(600) }
  modeNow = (await evaluate<string>(`document.querySelector('[data-action="media-mode"]')?.textContent?.trim()`)) ?? ""
  console.log(`    第 ${attempt} 次尝试,模式现在: ${modeNow}`)
  if (modeNow === "语音识别") break
  await sleep(400)
}
if (modeNow !== "语音识别") { console.error("✗ 三次重试都切不到语音识别"); ws.close(); process.exit(1) }

// ====== 2:点编辑器 + @creations/audio/ ======
console.log("\n[2] 点编辑器 + @creations/audio/ 过滤到音频文件…")
const ed = await evaluate<{ x: number; y: number } | null>(`(() => {
  const e = [...document.querySelectorAll('[contenteditable]')].find(x => x.getBoundingClientRect().width > 200)
  if (!e) return null; const r = e.getBoundingClientRect()
  return { x: Math.round(r.x + 40), y: Math.round(r.y + r.height/2) }
})()`)
if (!ed) { console.error("✗ 没找到编辑器"); ws.close(); process.exit(1) }
await clickAt(ed.x, ed.y)
await sleep(250)
// 直接匹 1779 前缀 wav(user 截图同款文件名)
await typeText("@1779")
await sleep(800)

const filtered = await evaluate<{ items: Array<{ text: string; x: number; y: number }> }>(`(() => {
  const pops = [...document.querySelectorAll('div.bg-surface-raised-stronger-non-alpha')].filter(e => e.offsetParent !== null)
  if (!pops.length) return { items: [] }
  return { items: [...pops[0].querySelectorAll('button')].map(b => { const r = b.getBoundingClientRect(); return { text: (b.textContent ?? '').trim().slice(0, 80), x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2) } }) }
})()`)
console.log("    过滤后选项:")
for (const it of filtered.items.slice(0, 8)) console.log("      •", it.text)

if (!filtered.items.length) { console.error("✗ popover 空"); ws.close(); process.exit(1) }

// 优先挑具体 .wav / .mp3 文件,没有就第一项
const audioPick = filtered.items.find((i) => /\.(wav|mp3|m4a|ogg|opus)$/i.test(i.text)) ?? filtered.items[0]!
console.log("\n[3] 选中:", audioPick.text)
await clickAt(audioPick.x, audioPick.y)
await sleep(500)

const afterPick = await evaluate<string>(`document.querySelector('[contenteditable]')?.textContent?.slice(0, 120)`)
console.log("    编辑器内容:", JSON.stringify(afterPick))

// ====== 3:回车提交(ASR 不需要 prompt) ======
console.log("\n[4] 回车提交(ASR 只要音频文件,prompt 文字会被丢)…")
await sleep(200)
await pressKey("Enter", "Enter", 13)
console.log("    → 等捕获 /generate…")

let captured: Array<{ url: string; body: string }> = []
for (let i = 0; i < 20; i++) {
  await sleep(300)
  const c = await evaluate<Array<{ url: string; body: string }>>(`window.__capturedBodies || []`)
  if (Array.isArray(c) && c.length > 0) { captured = c; break }
}

console.log("\n[5] 捕获结果:")
if (!captured.length) { console.log("    ❌ 没捕获到 /generate POST"); ws.close(); process.exit(1) }
console.log("    body =", captured[0]!.body.slice(0, 400))

try {
  const parsed = JSON.parse(captured[0]!.body)
  const audioUrl = parsed?.input?.audioUrl
  const refFile = parsed?.input?.refFile
  const prompt = parsed?.input?.prompt
  console.log("\n=== 验证(ASR)===")
  console.log("  input.audioUrl    :", JSON.stringify(audioUrl))
  console.log("  input.refFile     :", JSON.stringify(refFile), "(应 undefined,asr 走 audioUrl 不走 refFile)")
  console.log("  input.prompt      :", JSON.stringify(prompt))
  console.log("  audioUrl 是绝对路径?:", typeof audioUrl === "string" && (/^[A-Za-z]:[\\\/]/.test(audioUrl) || audioUrl.startsWith("/")))
  console.log("  prompt 含 @ 字面? :", typeof prompt === "string" && prompt.includes("@"))

  const ok = typeof audioUrl === "string" && audioUrl.length > 0 &&
    (/^[A-Za-z]:[\\\/]/.test(audioUrl) || audioUrl.startsWith("/")) &&
    refFile === undefined &&
    (typeof prompt !== "string" || !prompt.includes("@"))
  if (ok) {
    console.log("\n🎉 ASR 修复真实生效:audioUrl 填绝对路径,refFile 正确为 undefined,prompt 剥除 @ 字面")
    ws.close(); process.exit(0)
  } else {
    console.log("\n❌ 验证失败")
    ws.close(); process.exit(1)
  }
} catch (e) {
  console.log("    解析 body 失败:", (e as Error).message)
  ws.close(); process.exit(1)
}
