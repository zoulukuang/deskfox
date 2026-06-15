feat-id: win-plugin-dist-rebuild-guard
status: done
related: ./3-changelog.md

# Windows 打包插件 dist 陈旧致 media-gen "Bun is not defined" — 修复(Tiny / bug-repro)

## 现象(bug-repro)

装完 **dev** 安装包冷启动,主进程 server 日志:

```
[media-gen] generate server start failed: ReferenceError: Bun is not defined
  at startMediaServer (.../ai.deskfox.app.dev/plugin/media-gen/dist/plugin.js:13718)
```

→ media-gen 生成服务起不来,装机后**媒体生成/创作功能坏**(无用户可见 toast,纯 backend,自动化测试冷启动日志才抓到)。

## 根因

- media-gen **源码 2026-06-12 已 Node 化**(`node-serve.ts` 用 `node:http` 的 `serveFetch` 替 `Bun.serve`,Electron 边车跑 Node 不再是 Bun)。
- 但 `packages/media-gen/dist/plugin.js`(gitignored 现场产物)是 **06-13 陈旧产物仍含 `Bun.serve`**,没人重建。
- `build-deskfox-electron.sh`(Mac)2026-06-15 已修为「**先重建插件 dist + Bun 守卫**」(`dev-feishu-binding-missing`),但 **`.ps1`(Windows)§3.5a 仍只 `Test-Path` 查存在、不重建** → Windows 打包静默混入陈旧 dist → 装机后 media-gen 插件 server 启动即 `Bun is not defined`。
- **同一反模式**:只查存在不查新鲜度(与 [`electron-icon-stale-fix`](../electron-icon-stale-fix/) 的 icon.ico 陈旧、飞书 dist 陈旧同源)。

## 修复

`packages/branding/scripts/build-deskfox-electron.ps1` §3.5a —— 镜像 `.sh` §3.5a:

- **「只查存在」→「先重建」**:打包前调 `build-feishu-plugin.ps1` + `build-media-gen-plugin.ps1`(自带时间戳判断,无源码变更秒跳过,不拖慢迭代)。
- **加 Bun 守卫**:重建后 `Select-String 'Bun\.serve'`,残留即 `throw`(失败前置暴露,杜绝陈旧/未适配 dist 混入发布物)。

## 改动文件

| 文件 | 改动 | 行数 |
|---|---|---|
| `packages/branding/scripts/build-deskfox-electron.ps1` | §3.5a「只查存在」→「先重建 plugin dist + Bun.serve 守卫」 | ~+18 / -10 |

> 插件 dist(`*/dist/plugin.js`)为 gitignored 现场产物,不入库;本修复保证每次打包从最新源码重建。

## 验证(端到端,安装版)

1. 重建 media-gen / feishu dist → `Bun.serve` 计数均 **0**。
2. 改后 `.ps1` 全流程重出 dev 安装包(插件重建 + Bun 守卫通过)→ 静默重装。
3. 冷启动安装版:`[media-gen] generate server: http://127.0.0.1:51737`(**成功启动**,原为 `start failed: Bun is not defined`);日志 `Bun is not defined` 计数 **0**;安装版 plugin.js `Bun.serve` **0**。
4. app 健康:20 会话 + 19 文件,错误 toast 0;冒烟全 PASS(boot/10 供应商/5 面板/6 设置含飞书/文件)。

## 回退方法

撤回 `build-deskfox-electron.ps1` §3.5a 改动即可(单点)。

## 附:自动化测试副带发现(非本修复范围)

- 冷启动健康脚本 `cold-start-health-check.py` 的 `is_transient` 只白名单 `Failed to load resource ... 500`,**漏了 `ERR_CONNECTION_REFUSED`**(sidecar ~1.5s 预热竞态,渲染器重试),致冷启动被误报 FAIL(实际用户可见 toast 为 0,app 正常连上)。建议把 `ERR_CONNECTION_REFUSED` 也并入 transient 白名单(脚本在 OPENCODE-PLAN/诊断工具/,另仓另修)。
