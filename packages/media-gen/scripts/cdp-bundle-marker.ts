// [fork-only] CDP 通用工具:抓 DeskFox 已加载 JS bundle 的源码,字节级搜特征字符串
// 用途:验证某段新增/修改的代码真打进了 release minified bundle(unit test 过但担心 build silently 漏的场景)
// 前提:DeskFox 9222 启动
// 用法:改下面 markers 数组放你想找的字面字符串(case sensitive),跑就出现次数 + 上下文片段
// 实证场景:`creation-edit-asr-no-file` 用它确认 helper 真在 release bundle 里(`buildCreationInput` 函数名 +
// `"image_edit"`/`"video_i2v"` switch case 字面)
const CDP = "http://127.0.0.1:9222"
const list = (await (await fetch(`${CDP}/json/list`)).json()) as Array<{ type: string; title: string; webSocketDebuggerUrl: string }>
const page = list.find((t) => t.type === "page" && t.title === "DeskFox")!
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map<number, (m: { result?: { result?: { value?: unknown } } }) => void>()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data as string)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)!(m)
    pending.delete(m.id)
  }
}
const send = (method: string, params: Record<string, unknown> = {}) =>
  new Promise<{ result?: { result?: { value?: unknown } } }>((r) => {
    const i = ++id
    pending.set(i, r)
    ws.send(JSON.stringify({ id: i, method, params }))
  })
await new Promise<void>((r) => (ws.onopen = () => r()))
await send("Runtime.enable")

async function evaluate<T = unknown>(expr: string): Promise<T> {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })
  return r.result?.result?.value as T
}

const scripts = await evaluate<string[]>(
  `[...document.querySelectorAll('script[src],link[rel="modulepreload"]')].map(s => s.src || s.href).filter(Boolean)`,
)
console.log("scripts/preloads:", scripts.length, "条")

const markers = ['"image_edit"', '"video_i2v"', '"audioUrl"', '"refFile"', "buildCreationInput"]

for (const url of scripts.slice(0, 5)) {
  const result = await evaluate<{ len: number; hits: Array<{ m: string; count: number; sample?: string }> } | null>(`(async () => {
    try {
      const t = await (await fetch(${JSON.stringify(url)})).text()
      const hits = ${JSON.stringify(markers)}.map(m => {
        let count = 0; let idx = 0; let first = -1
        while ((idx = t.indexOf(m, idx)) !== -1) { if (first<0) first = idx; count++; idx += m.length }
        return { m, count, sample: first>=0 ? t.slice(Math.max(0,first-25), first+m.length+25) : undefined }
      })
      return { len: t.length, hits }
    } catch (e) { return null }
  })()`)
  if (!result) {
    console.log("✗", url, "抓不到")
    continue
  }
  const short = url.split("/").pop() ?? url
  console.log(`\n=== ${short} (${result.len} bytes) ===`)
  for (const h of result.hits) {
    const marker = h.m.padEnd(24)
    if (h.count > 0) console.log(`  ✓ ${marker} 出现 ${h.count} 次  例: ...${h.sample ?? ""}...`)
    else console.log(`  · ${marker} 无`)
  }
}

ws.close()
process.exit(0)
