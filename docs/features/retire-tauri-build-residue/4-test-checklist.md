feat-id: retire-tauri-build-residue
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 4-test-checklist — 验收测试方案 + 结果(2026-06-21)

> R9 分支内验收闸。核心风险:**删 10 个 Tauri 残留文件后,Electron 构建/测试链是否完好**。
> 重点用例 = TC-6 真打一个 local 本地测试包端到端验证。全自动化执行,平台 macOS arm64。

## 三层测试方案 + 结果

| # | 用例 | 层级 | 预期 | 结果 |
|---|---|---|---|---|
| TC-1 | branding 全量测试 | 单元 | broken `updater-config` 已除、无回归 | ✅ **47 pass / 0 fail** |
| TC-2 | `lo-bundle-strip` 守护等价 | 单元 | 重写后断言真匹配 electron 脚本保护 | ✅ **18 pass / 33 expect** |
| TC-3 | fork 范围 typecheck | 静态 | 删文件/改注释无破坏引用 | ✅ **22/22 successful** |
| TC-4 | 改过脚本语法(6 sh) | 静态 | 注释改动未破坏 | ✅ `bash -n` 全过 |
| TC-5 | 全仓无残留死引用 | 静态 | 仅剩 2 处刻意保留的历史注释 | ✅ 符合(dialog-settings/electron-builder config) |
| TC-6 | **打 local 本地测试包** | 构建 e2e | build-deskfox-electron 链端到端可用 + LO 注入 | ✅ **exit 0**,LO bundle 健康 489MB 注入,产物 `dist-deskfox/mac-arm64/DeskFox 本地版.app` |
| TC-7 | post-build §5.5 LO 验证 | 构建 e2e | 最终 .app 含 soffice + 非空 presets | ✅ **`post-build verify: 最终 .app 含可执行 soffice + 非空 presets ✓`** |
| TC-8 | local 包冷启动健康 | e2e | 删脚本不影响运行时 | ✅ `server ready http://127.0.0.1:62593` + `client ready` + `ws client ready`,CDP DevTools listening,独立身份 `ai.deskfox.app.local`,无 fatal/exception |
| TC-9 | `bump-installer-version.sh` dry-run | 脚本回归 | 改注释后版本号链路仍正常 | ✅ `VERSION=2026.8.1`,退出 0 |

## 结论

**9/9 全过。** 删 10 个 Tauri 残留文件 + 重写测试 + 改注释后:
- Electron 构建链完好(真打出 local 包,LO 注入 + §5.5 验证全过)。
- 测试守护逻辑零丢失(LO 硬门槛/soffice 验证迁到 electron 脚本 + verify.ts,断言全绿)。
- broken CI 测试已消除(branding 47 pass)。
- 运行时零影响(local 包冷启动后端+前端健康)。
- 版本号/配套脚本链路完好(bump dry-run 正常)。

## 纪律留痕

- 打包前**只杀「本地版」,绝不碰正式版 `DeskFox.app`**(user 长期开着正式版开发;local 独立身份 `ai.deskfox.app.local` + `opencode-local.db` 数据隔离,与正式版共存)。全程验证正式版进程未被误杀。
- 本地测试包**不发布、不 bump、不入 git**(local 渠道,始终 `--dir`)。
