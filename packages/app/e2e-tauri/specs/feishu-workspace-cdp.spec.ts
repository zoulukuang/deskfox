// FORK: 飞书账号级 workspace — 真 exe + sidecar 端到端(CDP invoke 链路)
// [feat: feishu-account-workspace] 2026-06-07
//
// 验证完整后端链路:GUI invoke → Rust feishu_update_account_settings 命令 → wire →
// 插件 server /accounts/update-settings → account-store 写盘 → /accounts 读回。
// 跑在真 DeskFox.exe + 真插件 sidecar 上(非 mock),覆盖 spec 的 T11 + T8/T9 真机面 +
// T14 hot-apply 的"配置侧"(消息侧仍需 user 真飞书 QA)。
//
// 注:原生文件夹选择器(feishu_pick_workspace_dir)是 OS native dialog,CDP 驱动不了,
// 仍属 user 真桌面 QA(T13)。本 spec 不碰它(调用会弹框阻塞)。

import { test, expect } from "../fixtures"

const TEST_WS = "D:/project/opencode-fork"

/** 在 webview 里调 Tauri invoke(withGlobalTauri: true)*/
async function invoke<T>(page: any, cmd: string, args?: Record<string, unknown>): Promise<T> {
  return await page.evaluate(
    ([c, a]: [string, Record<string, unknown> | undefined]) =>
      (window as any).__TAURI__.core.invoke(c, a),
    [cmd, args] as const,
  )
}

type Acc = { account_id: string; workspace?: string | null }

/** 等插件 sidecar ready —— feishu_list_accounts 成功为准 */
async function waitAccounts(page: any, maxMs = 40_000): Promise<Acc[]> {
  const start = Date.now()
  let lastErr = ""
  while (Date.now() - start < maxMs) {
    try {
      return await invoke<Acc[]>(page, "feishu_list_accounts")
    } catch (e) {
      lastErr = String(e)
      await page.waitForTimeout(1000)
    }
  }
  throw new Error(`feishu_list_accounts 一直失败(sidecar 没起?): ${lastErr}`)
}

test("workspace 后端端到端:update-settings → 读回 → 清除(真 exe + sidecar)", async ({
  deskfoxApp,
}) => {
  const { page } = deskfoxApp

  // 1. 等 sidecar 起来 + 列账号
  const accounts = await waitAccounts(page)
  console.log(`[feishu-ws-e2e] 绑定账号数: ${accounts.length}`)
  expect(accounts.length).toBeGreaterThan(0)

  const target = accounts[0]!
  const accountId = target.account_id
  const original = target.workspace ?? null
  console.log(`[feishu-ws-e2e] 目标账号: ${accountId} 原 workspace: ${original ?? "(未设)"}`)

  // 2. 设 workspace 到测试路径(真实存在的目录)
  const setOk = await invoke<boolean>(page, "feishu_update_account_settings", {
    request: { account_id: accountId, workspace: TEST_WS },
  })
  expect(setOk).toBe(true)

  // 3. 读回 → 断言 workspace 已更新(全链路:Rust→wire→server→store 写→读)
  const afterSet = await invoke<Acc[]>(page, "feishu_list_accounts")
  const setAcc = afterSet.find((a) => a.account_id === accountId)
  console.log(`[feishu-ws-e2e] set 后 workspace: ${setAcc?.workspace}`)
  expect(setAcc?.workspace).toBe(TEST_WS)

  // 4. 空串清除 → 回退默认(workspace 应变回 null)
  const clearOk = await invoke<boolean>(page, "feishu_update_account_settings", {
    request: { account_id: accountId, workspace: "" },
  })
  expect(clearOk).toBe(true)

  const afterClear = await invoke<Acc[]>(page, "feishu_list_accounts")
  const clearedAcc = afterClear.find((a) => a.account_id === accountId)
  console.log(`[feishu-ws-e2e] clear 后 workspace: ${clearedAcc?.workspace ?? "(已清)"}`)
  expect(clearedAcc?.workspace ?? null).toBeNull()

  // 5. 还原原值(若原本设过;本环境原本未设 → 已是 null,无需动)
  if (original) {
    await invoke<boolean>(page, "feishu_update_account_settings", {
      request: { account_id: accountId, workspace: original },
    })
  }
})

test("workspace 非法类型被拒(校验链路)", async ({ deskfoxApp }) => {
  const { page } = deskfoxApp
  await waitAccounts(page)

  // workspace 传 number → Rust 反序列化失败 / server invalid_field → invoke reject
  let rejected = false
  try {
    await invoke(page, "feishu_update_account_settings", {
      request: { account_id: "cli_nonexistent", workspace: 123 },
    })
  } catch (e) {
    rejected = true
    console.log(`[feishu-ws-e2e] 非法 workspace 被拒(预期): ${String(e).slice(0, 120)}`)
  }
  expect(rejected).toBe(true)
})
