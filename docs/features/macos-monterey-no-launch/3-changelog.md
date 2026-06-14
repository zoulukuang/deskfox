---
feat-id: macos-monterey-no-launch
status: done
related: ./3-changelog.md
---

# 3-changelog — macos-monterey-no-launch

> Tiny 规模(38 行 / 1 文件 / fork-only 脚本),按规范只写 3-changelog.md。

## 背景 / 现象

用户报:2026.6.5.1 在一台 **MacBook Air (M1, 2020) + macOS Monterey 12.0.1** 上**安装成功但点击图标无反应、无弹窗**。

## 根因

打包链路里各 Mach-O 的最低系统版本(`minos` / `LC_BUILD_VERSION`)不一致:

| 组件 | 原 minos | Monterey 12.0.1 |
|---|---|---|
| 主程序 DeskFox(Tauri/Rust) | 11.0 | ✓ 能启动 |
| `.app` Info.plist `LSMinimumSystemVersion` | 10.13 | ✓ |
| **sidecar `opencode-cli`(Bun 编译)** | **13.0** | ✗ **dyld 拒绝加载** |

`opencode-cli` 是用 **Bun 1.3.14** 编译的后端进程,而 **Bun 自 1.2 起官方放弃 macOS 12**,其 runtime 二进制 `minos` 被标成 13.0。Monterey 12.0.1 < 13.0 → 主程序能起、`.app` 能启动,但 sidecar 后端进程被 dyld 拦死 → 前端连不上后端 → 表现为"点了没反应"。

据 Bun issue [#15873](https://github.com/oven-sh/bun/issues/15873),该 `minos=13.0` 是**编译配置问题**,Bun 实际代码可在 macOS 12 运行(issue 报告者实测 1.1.40)。

## 修法

`packages/branding/scripts/build-deskfox.sh` 两处(均 fork-only,FORK marker 标注):

1. **sidecar minos 回贴 12.0**:sidecar 落位后、Tauri 签名前,用 `vtool -set-build-version macos 12.0 <sdk> -replace` 把 minos 从 13.0 降到 12.0,再 `codesign --force --sign -` ad-hoc 重签(改 load command 会废掉原签名;prod 构建后 Tauri 用 Developer ID 覆盖此签名,签名不改 minos,12.0 保留)。幂等(已是 12.0 跳过),仅 darwin,patch 失败 `exit 1` 硬拦。
2. **`minimumSystemVersion` floor 钉 12.0**:经 `--config '{"bundle":{"macOS":{"minimumSystemVersion":"12.0"}}}'` 注入(不动 base tauri.conf.json,merge-safe),主二进制 minos + Info.plist `LSMinimumSystemVersion` 一起钉成 12.0。作用:① 声明真实支持下限 ② 低于 12 的用户(Big Sur 11 等)在安装/启动时收到明确"需要 macOS 12"弹窗,而非把同样的死图标 bug 平移给他们。

## 验证

本机(macOS 新版,SDK 26.5)完整 dev build(`build-deskfox.sh -Env dev`)产出 `DeskFox Dev.app`,验最终 `.app`:

- ① Info.plist `LSMinimumSystemVersion` = **12.0** ✓
- ② 主二进制 minos = **12.0** ✓
- ③ sidecar `opencode-cli` minos = **12.0**,`codesign -v` 签名有效 ✓
- LibreOffice(soffice + 122 个 dylib)全 minos **11.0**,Monterey 上无第二卡点 ✓
- sidecar 独立 `--version` 正常、本机启动监听 64796 正常、无新崩溃日志 ✓

## ⚠️ 残留风险(必须真机验证)

本机系统太新,**无法验证"在 macOS 12 上能否真跑"**——这是赌 Bun 1.3.14 实际不依赖 macOS 13 独有符号(issue 实测的是旧版 1.1.40)。**必须在真 Monterey 12.0.1 机器上启动新包确认**:
- 成功:正常进主界面 = 修复成立。
- 失败:若 sidecar 报 `dyld: symbol not found` = Bun 真用了 13 的符号 → 退回"让对方升级系统"(M1 Air 可免费升 Ventura+)。

## 决策依据(市场数据)

要求 macOS 13+ 会挡掉的存量用户:Steam 硬件调查(2026-05,广义消费者)显示 **macOS ≤12 仅约 0.41%**;Statcounter 的"8–12%"因 Apple Safari UA 冻结(新版全报成 Catalina 10.15)被污染,不可信。真实尾巴是个位数小量,但 DeskFox 面向非研发普通用户,且修复成本极低(38 行),故修复值得做。

## 规模 / 影响

- **Tiny**:`build-deskfox.sh` +38 行,纯 fork-only 脚本,0 改上游、0 R4 override、0 黑名单。
- **回退**:`git revert` 本 commit 即恢复(无副作用,不影响已构建产物)。
- **回归**:本机 dev build 全程绿;不触动任何产品代码 / 测试。
- **Win 端无关**:Windows 无 Mach-O minos 概念,`minimumSystemVersion` 仅 macOS 段,build-deskfox.ps1 不受影响。
