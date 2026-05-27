// [fork-only] media-gen — 打包成单文件 dist/plugin.js(供 installer 内置,照 feishu-bridge 套路)
// [feat: media-gen-alibaba] 2026-05-26
// 开发期用不到(opencode 可直接 file:// 加载 src/index.ts);此脚本是后续 installer 注入的预备。

const result = await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  target: "node",
  format: "esm",
  naming: "plugin.js",
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
console.log("✓ built dist/plugin.js")
