feat-id: macos-intel-x64-build
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实施计划 + 决策轨迹

## 施工单元(实代码核验后据实收窄)

| 单元 | 内容 | 落点 | 规模 |
|---|---|---|---|
| U1 | x64 LO bundle 输出到独立 `macos-x64/` | `prepare-lo-bundle.sh` | 极小 |
| U2 | config 读目标 arch + LO 路径分叉 + `mac.target` 显式 arch | `electron-builder.deskfox.config.ts`(fork,豁免) | 小 |
| U3 | build 脚本 `--arch` 参数 + LO/签名/产物路径连动 | `build-deskfox-electron.sh` | 小〜中 |
| U4 | 签名/公证 arch 无关,复用现有证书+凭据 | (并入 U3) | 小 |
| **N1** | **x64 原生预编译安装**(交叉打包坑之一) | `build-deskfox-electron.sh` | 小 |
| **N2** | **打包按目标 arch 选 node-pty 子包**(交叉打包坑之二) | `electron.vite.config.ts`(上游,R4) | 小 |

## 决策轨迹 / 踩坑记录

### note 1 — updater 想定订正(核验阶段)
需求文档原设「独立 `latest-mac-x64.yml`」不生效。实读 `electron-updater` `MacUpdater.js` 证实 Mac 只取单本 `latest-mac.yml`,arch 靠 `files[]` URL 分流。→ 订正为单 yml 双 arch 合并(本期不做,记录待 U5)。

### note 2 — 交叉打包 node-pty 崩溃(两轮迭代,本需求真正难点)
Intel 测试者装完报 `Failed to load native module: pty.node ... Cannot find './prebuilds/darwin-x64/pty.node'`,require stack 指向 `@lydell/node-pty-darwin-arm64`。分两层根因,**第一轮只修了一半**:

- **N1(第一轮)**:`@lydell/node-pty` 按平台拆独立预编译 optional 包;bun 在 arm64 主机按包 `cpu/os` 字段**只装 darwin-arm64**。交叉打 x64 时磁盘无 x64 `pty.node` → electron-builder 打进 arm64 的。
  **修法**:x64 build 前 `bun install --cpu='*' --no-save`(装齐两架构预编译;`--no-save` 防 npmmirror 绝对 URL 污染 `bun.lock`)+ 硬校验 x64 `pty.node` 在位。
  **验证盲区**:第一轮用「仓库 node_modules 走主包运行时分发」的 Rosetta 测试**通过了**,但没覆盖 app 里真正运行的 bundle → 误判已修,实际仍崩。

- **N2(第二轮,真凶)**:`electron.vite.config.ts` 的 `node-pty-narrower` 插件把 `import '@lydell/node-pty'` 改写成宿主子包并 externalize,算 arch 用**构建机 `process.arch`**(arm64)→ x64 bundle 里 `import ... "@lydell/node-pty-darwin-arm64"` 被**写死**,与运行机无关。Intel 上 arm64 子包 loader 去找自身没有的 `darwin-x64/pty.node` → 崩。
  **修法**:config 改读 `process.env.DESKFOX_TARGET_ARCH || process.arch`,build 脚本按 `--arch` 注入该 env。缺省回落 `process.arch`,原生打包零变化。
  **验证升级**:改测法为**字节 grep 交付 app.asar**(证实 import 只剩 x64、0 arm64)+ 用 **app 自带 x64 Electron 在 Rosetta 下加载 app 自带的 node-pty**(spawn 成功)→ 真 Intel Mac 安装启动**成功**。

### note 3 — 教训沉淀
交叉编译验证**必须针对最终 bundle / 交付产物**,不能测「仓库源 / 走另一条 code path 的等价物」—— 否则会像第一轮那样自证通过却仍崩。native 交叉打包尤其要落到「目标 arch 身份下实跑交付物」。
