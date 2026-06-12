// [fork-only] media-gen — CDP 自测创作模式交互层(驱动真实 DeskFox WebView2,真实鼠标事件)
// [feat: media-creation-mode] 2026-05-27
// 前提:DeskFox 以 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 启动。

const CDP = "http://127.0.0.1:9222"
const list = (await (await fetch(`${CDP}/json/list`)).json()) as Array<{ type: string; title: string; webSocketDebuggerUrl: string; url: string }>
const page = list.find((t) => t.type === "page" && t.title === "DeskFox") ?? list.find((t) => t.type === "page")
if (!page) { console.error("✗ 没找到 DeskFox 页面"); process.exit(1) }
console.log("→ page:", page.url)

const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map<number, (m: any) => void>()
ws.onmessage = (e) => { const m = JSON.parse(e.data as string); if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id) } }
const send = (method: string, params: any = {}) => new Promise<any>((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })) })
await new Promise<void>((r) => (ws.onopen = () => r()))
await send("Runtime.enable")

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function evaluate(expr: string) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) return { __exception: r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text }
  return r.result?.result?.value
}
async function clickAt(x: number, y: number) {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y })
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 })
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 })
}
/** 取某选择器中心坐标(可带文本过滤)*/
async function center(selector: string, contains?: string) {
  const expr = `(() => {
    const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const el = ${contains ? `els.find(e => e.textContent.includes(${JSON.stringify(contains)}))` : `els[0]`};
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: el.textContent.trim() };
  })()`
  return evaluate(expr)
}

// 1) 模式菜单触发器
const modeTrig = await center('[data-action="media-mode"]')
console.log("\n[1] 模式菜单触发器:", JSON.stringify(modeTrig))
if (!modeTrig || (modeTrig as any).__exception) { console.error("✗ 没找到模式菜单"); ws.close(); process.exit(1) }

// 2) 点开菜单 → 列模式
await clickAt(modeTrig.x, modeTrig.y)
await sleep(450)
const modes = await evaluate(`[...document.querySelectorAll('[data-slot="select-select-item"]')].map(e => e.textContent.trim())`)
console.log("[2] 菜单模式列表:", JSON.stringify(modes))

// 3) 菜单样式:宽度 + 列表高度上限 + 是否滚动
const style = await evaluate(`(() => {
  const c = document.querySelector('[data-component="select-content"].media-mode-select');
  const lb = c?.querySelector('[data-slot="select-select-content-list"]');
  return { contentFound: !!c, minWidth: c && getComputedStyle(c).minWidth, listMaxHeight: lb && getComputedStyle(lb).maxHeight, scrollable: lb ? lb.scrollHeight > lb.clientHeight + 1 : null };
})()`)
console.log("[3] 菜单样式:", JSON.stringify(style))

// 4) 选「文生图」
const t2i = await center('[data-slot="select-select-item"]', "文生图")
console.log("[4] 文生图选项:", JSON.stringify(t2i))
if (t2i && !(t2i as any).__exception) {
  await clickAt(t2i.x, t2i.y)
  await sleep(600)
  const after = await evaluate(`(() => {
    const modeTrig = document.querySelector('[data-action="media-mode"]');
    const modelTrig = document.querySelector('[data-action="media-model"]');
    const agentTrig = document.querySelector('[data-action="prompt-agent"]');
    const chatModel = document.querySelector('[data-action="prompt-model"]');
    return { modeLabel: modeTrig?.textContent.trim(), modelDropdown: modelTrig?.textContent.trim() ?? null, agentHidden: !agentTrig, chatModelHidden: !chatModel };
  })()`)
  console.log("[5] 选文生图后左侧随动:", JSON.stringify(after, null, 2))
}

ws.close()
process.exit(0)
