// FORK: REQ-062 [feat: v2026.8.2] U4 —— CDP 真机回归:文件夹选中态 = filled 底色、无 ring 线框。
//   在真·本地版上跑(真实文件树),L3 层。用法:
//     1) 起带调试端口的本地版(见 README.md),并在 app 里打开一个含文件夹的项目
//     2) node packages/app/e2e/cdp/folder-selection.cdp.mjs
//   断言:点选一行文件夹 → 其 class 含 bg-surface-base-active 且不含任何 ring-*。
import { connectApp, modifierClick } from "./connect.mjs"

const { browser, page } = await connectApp()

const rows = page.locator("[data-tree-path]")
const count = await rows.count()
if (count === 0) {
  console.error("✗ 没有文件树行([data-tree-path])。请先在本地版里打开一个含文件夹的项目再跑。")
  await browser.close()
  process.exit(2)
}

// 取第一行(文件树根下第一项),多选点击它
const row = rows.first()
const pathName = await row.getAttribute("data-tree-path")
await modifierClick(page, row)
await page.waitForTimeout(200)

const cls = (await row.getAttribute("class")) ?? ""
const hasFilled = cls.includes("bg-surface-base-active")
const hasRing = /\bring-/.test(cls)

await page.screenshot({ path: "/tmp/u4-folder-selection.png" }).catch(() => {})

console.log(`row="${pathName}"`)
console.log(`  bg-surface-base-active: ${hasFilled ? "✓ 有" : "✗ 无"}`)
console.log(`  ring-* 线框:           ${hasRing ? "✗ 仍有(REQ-062 未生效)" : "✓ 无"}`)

await browser.close()
if (hasFilled && !hasRing) {
  console.log("✅ U4 PASS — filled 高亮 + 无 ring 线框")
  process.exit(0)
}
console.error("❌ U4 FAIL")
process.exit(1)
