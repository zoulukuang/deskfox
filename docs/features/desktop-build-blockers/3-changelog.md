feat-id: desktop-build-blockers
status: done
related: ./3-changelog.md

# 桌面打包链路阻塞排查(Tiny)

> 2026-08-18。起因:做「会话呈现与输入修复批」的 GUI 验证时想打 local 包,连撞两个失败,
> 当时判定为「两处环境阻塞,会挡住下次发版」。实际排查后**一真一假**,记录如下。

## ① sidecar 下载恒失败 —— 真阻塞,已修

**现象**:`bun run build`(桌面打包第一步)恒失败在 prebuild:

```
error: No version matching "0.0.0-next-16350" found for specifier
       "@opencode-ai/cli-darwin-arm64" (but package exists)
```

wrapper `build-deskfox-electron.sh:222` 就是 `bun run build`,所以**整条 `/ship` 走不下去**。

**根因**:开发机 `BUN_CONFIG_REGISTRY=https://registry.npmmirror.com`(固化在 `~/.zshenv`,
日常装依赖提速),而 **npmmirror 不同步 opencode 的 `0.0.0-next-*` 预发布版**:

| registry | 该包总版本数 | 含 `next` 的版本数 | 含 `0.0.0-next-16350` |
|---|---|---|---|
| registry.npmjs.org | 3192 | 1035 | ✅ |
| registry.npmmirror.com | 85 | **0** | ❌ |

不是版本号写错,也不是包被删 —— 是镜像覆盖面问题。

**修法**(`packages/desktop/scripts/utils.ts`):sidecar 这一条 install 显式 `--registry`,
默认 `https://registry.npmjs.org`,可用 `OPENCODE_CLI_REGISTRY` 覆盖(离线/私有源场景)。
**只影响这一个包**,其余依赖照旧走镜像。

> ⚠️ 为什么不能「换个镜像上有的版本」绕过:`CLI_VERSION` 是上游 pin 的,**每次上游同步都会变**,
> 下次同步后同样的坑会立刻复发。必须让这条 install 绕开镜像本身。

顺带把 bun 那句含糊报错包成带根因 + 可执行指引的诊断(排查这条花了不少时间,不该让下一个人重来)。

**验证**:
- 正常路径 `bun run prebuild` 通过,sidecar 144 MB 落到 `resources/opencode-cli` 并完成 ad-hoc 签名;
- 反向路径 `OPENCODE_CLI_REGISTRY=https://registry.npmmirror.com bun run prebuild` 复现原始故障,
  新诊断正确打印(即本条的 `[bug-repro:]`);
- typecheck 29/29。

## ② electron-builder 600s 下载超时 —— **假警报,无需改动**

**当时现象**:`electron-builder --mac --dir` 两次都在下载环节 600s 超时。

**实际原因**:我为了绕开 ① 而**直接调 `node_modules/.bin/electron-builder`,跳过了 wrapper** ——
而 mac wrapper `build-deskfox-electron.sh:212-217` **早就配好了**:

```sh
export ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"
export ELECTRON_BUILDER_BINARIES_MIRROR="${ELECTRON_BUILDER_BINARIES_MIRROR:-…}"
export ELECTRON_CACHE="/Volumes/ExtSSD/.cache/electron"
```

裸调等于丢掉这三项 → Electron zip 走 GitHub + 代理 → 卡住。**ship 正常流程不受影响。**

**教训**:验证打包链路时**别绕过 wrapper**。wrapper 不只是"选 channel + 注版号",
它还封装了国内网络的三处规避;绕过它得到的失败结论会误导排查方向(本次就误报了一条)。

## 影响面 / 回退

- 改动 1 文件、约 20 行(含注释与诊断),`packages/desktop/scripts/utils.ts`,不触黑名单、无需 R4。
- 回退:`git revert 8d07ddcd0c`。回退后 prebuild 在国内镜像环境下会重新恒失败。
