// [fork-only] CDP 运行时验证 — catalog 数据/代码分层后,确认内联 JSON 的目录在真实边车里正常加载
// [feat: media-catalog-data-extract] 2026-06-01
// 前提:DeskFox 以 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 启动,且已进创作模式可见 prompt 输入。
// 做法:遍历模式(能力)菜单 → 每个能力展开模型下拉 → 收集所有模型显示名 → 与 catalog.data.json 期望集合比对。
// 不真打任何 API,纯读 UI 列表。

import { BUILTIN_CATALOG, CAPABILITY_LABEL } from "../src/catalog"

const CDP = "http://127.0.0.1:9222"
const list = (await (await fetch(`${CDP}/json/list`)).json()) as Array<{ type: string; title: string; webSocketDebuggerUrl: string; url: string }>
const page = list.find((t) => t.type === "page" && t.title === "DeskFox") ?? list.find((t) => t.type === "page")
if (!page) { console.error("✗ 没找到 DeskFox 页面"); process.exit(1) }

const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map<number, (m: any) => void>()
ws.onmessage = (e) => { const m = JSON.parse(e.data as string); if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id) } }
const send = (method: string, params: any = {}) => new Promise<any>((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
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
async function pressEscape() {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 })
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 })
}
async function center(selector: string, contains?: string) {
  const expr = `(() => {
    const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const el = ${contains ? `els.find(e => (e.textContent||'').includes(${JSON.stringify(contains)}))` : `els[0]`};
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
  })()`
  return evaluate(expr) as Promise<any>
}
const itemTexts = () => evaluate(`[...document.querySelectorAll('[data-slot="select-select-item"]')].map(e => (e.textContent||'').trim())`)

// 0) 前置:media-mode 触发器是否存在
const modeTrig = await center('[data-action="media-mode"]')
if (!modeTrig || (modeTrig as any).__exception) {
  console.error("✗ 没找到 [data-action=\"media-mode\"] — 可能不在创作模式/session 视图。请在 DeskFox 里进任一会话再跑。")
  ws.close(); process.exit(2)
}

// UI 模型下拉显示「厂商 model id」;UI 能力标签真相源在前端 CREATION_MODES(catalog.ts CAPABILITY_LABEL
// 是插件侧副本,已对齐同名,见 catalog-capability-label-sync)。为稳健,能力遍历仍直接用菜单实际标签
// (排除 Chat),模型按 model id 比对。
const expectedModelIds = [...new Set(BUILTIN_CATALOG.map((e) => e.model))]
const catalogCapCount = new Set(BUILTIN_CATALOG.map((e) => e.capability)).size // 9

// 1) 打开模式菜单,读能力列表
await clickAt(modeTrig.x, modeTrig.y)
await sleep(500)
const modes = (await itemTexts()) as string[]
await pressEscape(); await sleep(200)
console.log("\n[模式/能力菜单] 实际:", JSON.stringify(modes))
const creationModes = modes.filter((m) => m && m !== "Chat")
console.log(`参考:catalog.ts CAPABILITY_LABEL = ${JSON.stringify(Object.values(CAPABILITY_LABEL))}(已对齐前端 CREATION_MODES)`)

// 2) 逐个能力 → 选中 → 展开模型下拉 → 收集模型名
const seenModels = new Set<string>()
for (const mode of creationModes) {
  // 开模式菜单选该能力
  const mt = await center('[data-action="media-mode"]')
  if (!mt || (mt as any).__exception) break
  await clickAt((mt as any).x, (mt as any).y); await sleep(400)
  const item = await center('[data-slot="select-select-item"]', mode)
  if (!item || (item as any).__exception) { await pressEscape(); await sleep(150); console.log(`  · ${mode}: ✗ 模式项未找到`); continue }
  await clickAt((item as any).x, (item as any).y); await sleep(550)
  // 开模型下拉
  const modelTrig = await center('[data-action="media-model"]')
  if (!modelTrig || (modelTrig as any).__exception) { console.log(`  · ${mode}: (无模型下拉)`); continue }
  await clickAt((modelTrig as any).x, (modelTrig as any).y); await sleep(450)
  const models = (await itemTexts()) as string[]
  await pressEscape(); await sleep(150)
  models.forEach((m) => m && seenModels.add(m))
  console.log(`  · ${mode}: ${JSON.stringify(models)}`)
}

// 3) 比对(按 model id)
const missingModels = expectedModelIds.filter((exp) => ![...seenModels].some((s) => s.includes(exp)))
console.log("\n========== 结果 ==========")
console.log(`创作能力档:期望 ${catalogCapCount} 个,菜单实际 ${creationModes.length} 个 → ${creationModes.length >= catalogCapCount ? "✓" : "✗"}`)
console.log(`期望模型(按 model id)${expectedModelIds.length} 个,下拉里缺失:`, missingModels.length ? JSON.stringify(missingModels) : "无 ✓")
console.log(`下拉实际出现的不同模型项数:${seenModels.size}`)
const pass = creationModes.length >= catalogCapCount && missingModels.length === 0
console.log(pass ? "\n✅ PASS — 内联 JSON 的 catalog 在运行时完整加载" : "\n❌ FAIL — 有缺失,见上")
ws.close()
process.exit(pass ? 0 : 1)
