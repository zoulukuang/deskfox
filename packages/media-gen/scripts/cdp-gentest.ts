// [fork-only] media-gen — CDP 自测:创作模式端到端生成(打字 + 回车 → 结果卡)
// [feat: media-creation-mode] 2026-05-27 — 前提同 cdp-uxtest(9222 远程调试 + 已在文生图模式)

const CDP = "http://127.0.0.1:9222"
const list = (await (await fetch(`${CDP}/json/list`)).json()) as Array<{ type: string; title: string; webSocketDebuggerUrl: string }>
const page = list.find((t) => t.type === "page" && t.title === "DeskFox") ?? list.find((t) => t.type === "page")!
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map<number, (m: any) => void>()
ws.onmessage = (e) => { const m = JSON.parse(e.data as string); if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id) } }
const send = (method: string, params: any = {}) => new Promise<any>((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
await new Promise<void>((r) => (ws.onopen = () => r()))
await send("Runtime.enable")
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const evaluate = async (expr: string) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) return { __exception: r.result.exceptionDetails.exception?.description }
  return r.result?.result?.value
}

// 确认当前在文生图模式(左侧有模型下拉)
console.log("当前模型下拉:", await evaluate(`document.querySelector('[data-action="media-model"]')?.textContent.trim() ?? null`))

// 聚焦编辑器 + 输入 prompt
const ed = await evaluate(`(() => { const e=document.querySelector('[contenteditable="true"]')||document.querySelector('[contenteditable]'); if(!e) return null; e.focus(); const r=e.getBoundingClientRect(); return {x:Math.round(r.x+30), y:Math.round(r.y+r.height/2)}; })()`)
console.log("编辑器:", JSON.stringify(ed))
if (ed?.x) {
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: ed.x, y: ed.y, button: "left", clickCount: 1 })
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: ed.x, y: ed.y, button: "left", clickCount: 1 })
  await sleep(150)
}
// 逐字符按键(更接近真人打字,触发 SolidJS prompt 上下文同步)
for (const ch of "一只橘色的小狐狸纯白背景卡通") {
  await send("Input.dispatchKeyEvent", { type: "keyDown", text: ch, key: ch })
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: ch })
  await sleep(20)
}
await sleep(400)
console.log("编辑器文本:", await evaluate(`document.querySelector('[contenteditable]')?.textContent`))

// 回车提交(应被创作模式拦截 → runCreation)
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
console.log("→ 已回车,等待生成…")

// 轮询结果卡(找"已保存:"或"失败"或进度)
let done: any = null
for (let i = 0; i < 30; i++) {
  await sleep(2000)
  const r = await evaluate(`(() => {
    const saved = [...document.querySelectorAll('span')].find(s => s.textContent.startsWith('已保存:'));
    const statusLeaf = [...document.querySelectorAll('div')].find(d => d.children.length===0 && /·\s*(完成|失败)$/.test(d.textContent.trim()) && /通义/.test(d.textContent));
    const card = statusLeaf && statusLeaf.parentElement;
    return {
      saved: saved ? saved.textContent.slice(0,120) : null,
      terminal: !!statusLeaf,
      isErr: statusLeaf ? /失败/.test(statusLeaf.textContent) : false,
      cardText: card ? card.textContent.replace(/\s+/g,' ').trim().slice(0,180) : null,
    };
  })()`)
  if (r && (r.saved || r.terminal)) { done = r; break }
  if (i % 3 === 0) console.log(`  …${(i + 1) * 2}s`)
}
console.log("\n结果:", JSON.stringify(done, null, 2))
ws.close()
process.exit(0)
