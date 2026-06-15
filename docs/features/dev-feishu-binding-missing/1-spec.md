feat-id: dev-feishu-binding-missing
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 1-spec — Electron dev 包飞书账号显示"未绑定"根治

> 规模:**Medium**(诊断密集 + 构建管线根因修复;Electron 换基座 follow-up)
> 起源:2026-06-15 user 在 Electron dev 包看「设置 → 飞书桥接」显示"尚未绑定飞书账号",但平时正式版有 3 个绑定账号,质疑数据为何不见。

## 现象

Electron dev 测试包(`ai.deskfox.app.dev`)飞书桥接页显示"尚未绑定飞书账号 / 添加飞书账号"空态,而 user 在正式版 `/Applications/DeskFox.app` 已绑 3 个账号(InveM🐼-Mac / 灵狐🦊-Mac / FoxPlan-Mac)。

## 诊断结论(根因)

1. **数据未丢、非身份隔离**:3 个账号完好在**共享** `~/.opencode/feishu-config.json`(HOME 级,不分 app 身份);Electron 后端 `os.homedir()` = 真实 home,路径指向同一份。
2. **真因 = 陈旧插件产物 + Bun→Node 基座差异**:
   - Electron 边车跑 **Node**(旧 Tauri 是 Bun sidecar 二进制);飞书插件 HTTP server 原用 `Bun.serve`。
   - 源码 2026-06-12 已适配(`adapter-feishu-lark/src/node-serve.ts` 用 `node:http` 实现 `Bun.serve` 子集,`server.ts` 改调 `serveFetch`)。
   - **但打进 dev 包的 `dist/plugin.js` 是 2026-06-09 陈旧产物**(早于适配),仍含 `Bun.serve` → Node 下抛 `ReferenceError: Bun is not defined` → 飞书插件 server 起不来。
   - 连锁:server 没起 → 前端读到的 `~/.opencode/feishu-plugin-server.json`(正式版 Tauri+Bun 早上写的 port 60387)已死 → 列账号请求失败 → UI 回退"未绑定"。
   - media-gen 插件同病(dist 陈旧),日志实锤 `[media-gen] ... ReferenceError: Bun is not defined`。
3. **症结**:`build-deskfox-electron.sh` 打包前**只检查插件 dist 存在、不重建**(§3.5a),陈旧 dist 静默混入。

## 验收标准

- **AC1**:飞书 / media-gen 插件 `dist/plugin.js` 从最新源码重建后 `Bun.serve` 残留为 0。
- **AC2**:`build-deskfox-electron.sh` 打包前自动重建两插件 dist,且 post-build 守卫断言 bundle 内无 `Bun.serve`(残留即 fail,防再静默混入)。
- **AC3**:新 dev 包启动后飞书插件 server 在 Node 下正常监听(写新 server.json + 活端口),`Bun is not defined` 计数为 0,3 个账号 WSS 全连;`/accounts` 返回 3 账号;UI 列出 3 个账号。

## 范围外(本次不动,另记)

- dev 包启动 `plugin-install: exclusive takeover` 会抢掉正式版 `/Applications/DeskFox.app` 在 `~/.config/opencode/opencode.jsonc` 的插件注册——prod/dev 同机并存互争注册项,独立隐患,后续单独排查。
- 飞书图片/文件上传(multipart)在 Node 下的 Buffer/form-data 兼容性(历史 Bun-plugin-form-data 坑),待插件起来后单独验。
