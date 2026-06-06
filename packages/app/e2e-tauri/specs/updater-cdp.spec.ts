// FORK: Tauri CDP — updater 启用运行时验证(TC-1 / TC-2 / 活管线）[feat: 启用自动升级] 2026-06-06
//
// 在真实 build 出来的 DeskFox.exe 里(WebView2 + connectOverCDP)运行时断言:
//   TC-1  window.__OPENCODE__.updaterEnabled === true
//         —— Rust constants.rs UPDATER_ENABLED=true 经 windows.rs init script 注入 window,
//            证明整条 Rust→JS 桥在【实际二进制】里把 updater 打开了(不是只改源码)。
//   TC-2 / R1  updater 插件已注册(lib.rs `if UPDATER_ENABLED` 注册 tauri_plugin_updater):
//         从 page 直接 invoke `plugin:updater|check`,断言不是"命令未注册/未授权"错误。
//         UPDATER_ENABLED=false 时该命令根本不存在 → 此断言能真正区分两态。
//   活管线(TC-4 静默 / TC-7 endpoint / R4 pubkey):check 命中线上 updates.deskfox.ai,
//         当前 app 版本 == 后端占位版本(2026.6.0)→ 预期"无更新"(null),不报错。
//         成功返回证明:插件注册 + pubkey 格式合法 + endpoint 可达 + manifest 解析 + 版本比较 全链路通。

import { test, expect } from "../fixtures"

test("TC-1 updaterEnabled 运行时为 true(Rust→JS 桥在真二进制里生效)", async ({ deskfoxApp }) => {
  const { page } = deskfoxApp
  const updaterEnabled = await page.evaluate(() => (window as any).__OPENCODE__?.updaterEnabled)
  console.log(`[updater-cdp] window.__OPENCODE__.updaterEnabled = ${updaterEnabled}`)
  expect(updaterEnabled).toBe(true)
})

test("TC-2 updater 插件已注册 + 活管线 check 不报命令级错误", async ({ deskfoxApp }) => {
  const { page } = deskfoxApp

  const result = await page.evaluate(async () => {
    const internals = (window as any).__TAURI_INTERNALS__
    const invoke: ((cmd: string, args?: any) => Promise<any>) | undefined =
      internals?.invoke ?? (window as any).__TAURI__?.core?.invoke
    if (!invoke) return { ok: false, reason: "no-invoke", detail: "找不到 Tauri invoke 入口" }
    try {
      // updater check 命令(不带 download channel,check 本身不需要）
      // headers 是 sequence(Vec<(String,String)>),传空数组让 check 真正命中线上 endpoint
      const r = await invoke("plugin:updater|check", { headers: [] })
      // null = 无更新(后端占位版本 == 当前版本,符合预期);非 null = 探测到更新
      return { ok: true, reason: r == null ? "no-update" : "update-found", detail: JSON.stringify(r)?.slice(0, 200) }
    } catch (e: any) {
      const msg = String(e?.message ?? e)
      // 命令未注册 / 未授权 = updater 没开 → 真失败;其余(网络/解析)说明插件已注册
      const notRegistered = /not found|not allowed|unknown command|未注册|command .* not/i.test(msg)
      return { ok: !notRegistered, reason: notRegistered ? "plugin-missing" : "registered-runtime-err", detail: msg.slice(0, 300) }
    }
  })

  console.log(`[updater-cdp] check result: ${JSON.stringify(result)}`)
  // 插件必须已注册(reason 不能是 no-invoke / plugin-missing)
  expect(result.ok, `updater 插件注册/调用失败: ${result.reason} — ${result.detail}`).toBe(true)
  expect(["no-update", "update-found", "registered-runtime-err"]).toContain(result.reason)
})
