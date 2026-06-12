// [fork-only] CDP 真用户 e2e — 小米 MiMo 4 能力路由 + 新 UI 控件验证
// [feat: media-gen-xiaomi] 2026-05-28
//
// 每个 case:切模式 → 选 MiMo 模型 → (tts_design 时填声线描述输入框) → 提交 → 拦 /generate body 验:
//   1) entryId 命中(dispatch 路由对)
//   2) tts_design 的 input.voiceDesignHint 字段传到了
//   3) tts_clone 的 file part 走 refFile(需手动 @<path> 引用本地 wav,见用例 prompt)
// 不真打小米 API(intercept 把所有 /generate 短路 SSE error 假回应,只看前端发出去的 body 长啥样)
//
// 用法:
//   1) 跑 build-deskfox.ps1 -Env dev -NoBundle 出新 DeskFox.exe(包含 fork 改动)
//   2) 终端: DeskFox.exe --remote-debugging-port=9222(或 launch.json 已开 9222)
//   3) bun run packages/media-gen/scripts/cdp-creation-xiaomi-all.ts

const CDP = "http://127.0.0.1:9222"
const tabs = (await (await fetch(`${CDP}/json/list`)).json()) as Array<{ type: string; title: string; url: string; webSocketDebuggerUrl: string }>
const page = tabs.find((t) => t.type === "page" && t.title === "DeskFox")!
if (!page) { console.error("✗ 没找到 DeskFox tab,确认 DeskFox 已运行且开了 9222 debug port"); process.exit(1) }
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

// 装 /generate 拦截器(只看前端发什么,不真打 API)
await evaluate(`(() => {
  window.__capturedBodies = []
  if (!window.__patched_xiaomi) {
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
    window.__patched_xiaomi = true
  }
  return "ok"
})()`)

async function clearEditorAndSwitchMode(modeName: string): Promise<boolean> {
  await evaluate(`(() => { const ed = [...document.querySelectorAll('[contenteditable]')].find(e => e.getBoundingClientRect().width > 200); if (ed) ed.focus() })()`)
  await send("Input.dispatchKeyEvent", { type: "keyDown", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65 })
  await send("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65 })
  await sleep(60)
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 })
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 })
  await sleep(120)
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

/** tts_design 专用:在工具栏的声线描述输入框里打字 */
async function fillVoiceDesignHint(hint: string): Promise<boolean> {
  const pos = await evaluate(`(() => { const el = document.querySelector('[data-action="media-voice-design-hint"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2) } })()`) as any
  if (!pos) return false
  await clickAt(pos.x, pos.y)
  await sleep(120)
  await typeText(hint)
  await sleep(180)
  const val = await evaluate(`document.querySelector('[data-action="media-voice-design-hint"]')?.value`) as string
  return val === hint
}

async function submitAndCapture(promptText: string): Promise<any> {
  await evaluate(`window.__capturedBodies = []`)
  const ed = await evaluate(`(() => { const e = [...document.querySelectorAll('[contenteditable]')].find(x => x.getBoundingClientRect().width > 200); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x+40), y: Math.round(r.y+r.height/2) } })()`) as any
  await clickAt(ed.x, ed.y)
  await sleep(180)
  await typeText(promptText)
  await sleep(200)
  await pressEnter()
  for (let i = 0; i < 20; i++) {
    await sleep(300)
    const c = await evaluate(`window.__capturedBodies || []`) as any[]
    if (c.length > 0) return JSON.parse(c[0].body)
  }
  return null
}

// ====== 跑 4 个 case ======
type Case = {
  name: string
  mode: string
  modelRegex: RegExp
  expectEntryId: string
  prompt: string
  /** tts_design 专属:测前往声线描述输入框填这段 */
  voiceDesignHint?: string
  /** 验:body.input 必须含这个字段名(image/video 不需要,tts 需 voice,tts_clone 需 refFile,tts_design 需 voiceDesignHint) */
  expectField?: { name: string; value?: string | RegExp }
}

const cases: Case[] = [
  {
    name: "语音合成 → mimo-v2.5-tts",
    mode: "语音合成",
    modelRegex: /mimo-v2\.5-tts$/,
    expectEntryId: "xiaomi-mimo-v2.5-tts",
    prompt: "你好,我是小米 MiMo。",
    expectField: { name: "voice", value: /.+/ }, // tts 应该有 voice 字段(虽然不强制特定值)
  },
  {
    name: "语音克隆 → mimo-v2.5-tts-voiceclone(需要 @<wav 路径> 引用)",
    mode: "语音克隆",
    modelRegex: /mimo-v2\.5-tts-voiceclone/,
    expectEntryId: "xiaomi-mimo-v2.5-tts-voiceclone",
    // 注意:user 真跑这个 case 前先用 @ 引用一个 wav 文件让 file part 存在;不引就会触发 dispatch 端 no_ref
    // CDP intercept 不真打 API,这里只验 entryId 路由对就行(refFile 字段实测看可选)
    prompt: "克隆这段声音说话",
  },
  {
    name: "语音设计 → mimo-v2.5-tts-voicedesign(填声线描述)",
    mode: "语音设计",
    modelRegex: /mimo-v2\.5-tts-voicedesign/,
    expectEntryId: "xiaomi-mimo-v2.5-tts-voicedesign",
    prompt: "请用我描述的声线说这句话。",
    voiceDesignHint: "中年男声沉稳磁性",
    expectField: { name: "voiceDesignHint", value: "中年男声沉稳磁性" },
  },
  {
    name: "转写 → mimo-v2.5(Omni 当 ASR)",
    mode: "语音识别",
    modelRegex: /mimo-v2\.5$/,
    expectEntryId: "xiaomi-mimo-v2.5-asr",
    prompt: "转写这段(需 @<wav 路径>)",
  },
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
  if (c.voiceDesignHint) {
    const ok = await fillVoiceDesignHint(c.voiceDesignHint)
    if (!ok) { console.log(`  ✗ 没找到 [data-action="media-voice-design-hint"] 输入框或填字失败`); fail++; continue }
    console.log(`  ✓ 声线描述填入: ${c.voiceDesignHint}`)
  }
  const body = await submitAndCapture(c.prompt)
  if (!body) { console.log("  ✗ 没捕获到 /generate body"); fail++; continue }
  console.log(`  捕获 body: ${JSON.stringify(body)}`)
  if (body.entryId !== c.expectEntryId) {
    console.log(`  ❌ entryId 错位:期望 "${c.expectEntryId}",实际 "${body.entryId}"`)
    fail++
    continue
  }
  console.log(`  ✓ entryId 命中 "${c.expectEntryId}"`)
  if (c.expectField) {
    const v = body.input?.[c.expectField.name]
    if (v === undefined) {
      console.log(`  ❌ body.input.${c.expectField.name} 缺失`)
      fail++
      continue
    }
    if (c.expectField.value !== undefined) {
      const ok = c.expectField.value instanceof RegExp ? c.expectField.value.test(String(v)) : v === c.expectField.value
      if (!ok) {
        console.log(`  ❌ body.input.${c.expectField.name} 值不对:期望 ${c.expectField.value},实际 ${v}`)
        fail++
        continue
      }
    }
    console.log(`  ✅ body.input.${c.expectField.name} = ${v}`)
  } else {
    console.log(`  ✅`)
  }
  pass++
}

console.log(`\n========== 汇总 ==========`)
console.log(`通过: ${pass} / ${cases.length}`)
console.log(`失败: ${fail}`)
ws.close()
process.exit(fail === 0 ? 0 : 1)
