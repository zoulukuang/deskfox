feat-id: macos-intel-x64-build
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# macOS Intel x64 安装包构建支持(2026-07-11,Medium)

commit:`74b1b64a40`(分支 `feat/macos-intel-x64-build`;hash 回填 commit 另计)

## 背景

DeskFox 原只出 macOS arm64 包。REQ-081 要求在 Apple Silicon 开发机交叉编译出 Intel x64 的签名+公证包。本期先出一个可手动下载安装的 x64 测试包(不碰 updater、不发布)。

## 实际改动(4 文件,~76 行)

| 文件 | 改动 | 黑名单 |
|---|---|---|
| `packages/branding/scripts/prepare-lo-bundle.sh` | x64 LO 输出到独立 `macos-x64/`(`DEST_SUBDIR` 按 `$ARCH` 分叉),不覆盖 arm64 `macos/`;末尾提示动态目录 | 否(branding) |
| `packages/desktop/electron-builder.deskfox.config.ts` | 加 `targetArch`(从 `--x64/--arm64` argv 派生)→ LO 注入目录分叉 + `mac.target` 显式声明 arch(`{target,arch}` 形式) | 否(`.deskfox.config.*` 例外) |
| `packages/branding/scripts/build-deskfox-electron.sh` | ① `--arch` 参数 + arch 归一化 + LO/签名/产物路径连动;② **§0.5 x64 交叉原生预编译安装 + 硬校验**;③ **export `DESKFOX_TARGET_ARCH`** 透传目标 arch | 否(branding) |
| `packages/desktop/electron.vite.config.ts` | `nodePtyPkg` 改读 `DESKFOX_TARGET_ARCH \|\| process.arch`,让 node-pty-narrower 插件按**目标** arch 选并 externalize 子包 | **是(R4,见下)** |

## 根因 + 修法(交叉打包 node-pty 两层坑)

Intel 真机首装报 `Failed to load native module: pty.node ... Cannot find './prebuilds/darwin-x64/pty.node'`。两层根因**都修才通**(详见 2-plan note 2):

1. **原生预编译缺失**:`@lydell/node-pty` 按平台拆独立预编译包,bun 在 arm64 主机只装 darwin-arm64 → 交叉打 x64 时磁盘无 x64 `pty.node`。修:`bun install --cpu='*' --no-save` 装齐 + 硬校验。
2. **bundle 写死构建机架构**(真凶):`electron.vite.config.ts` 用构建机 `process.arch` 算子包名,x64 bundle 被写死 `import "@lydell/node-pty-darwin-arm64"`。修:改读目标 arch env。

## 验证(对照 1-spec TC 清单)

- TC-1 ✅ `macos/`(arm64)+ `macos-x64/`(x64)并存,soffice 各为对应架构。
- TC-2 ✅ 主二进制 + 内嵌 LO 均 `Mach-O x86_64`。
- TC-3 ✅ 交付 app.asar 字节 grep:`import * as pty from "@lydell/node-pty-darwin-x64"`(2 处),**0 处 arm64**。
- TC-4 ✅ Rosetta 强制 `process.arch=x64` 加载 app 自带 `node-pty-darwin-x64` + `pty.spawn` 成功。
- TC-5 ✅ codesign valid / stapler worked / spctl `accepted · Notarized Developer ID`;bundle id `ai.deskfox.app`,Developer ID Application 证书(仓库外 `~/.deskfox-signing`)。
- **TC-6 ✅ 真 Intel Mac(MacBook Pro 2020 i5 / macOS 15.7.7)安装启动成功**(user 2026-07-11 反馈)。
- TC-7 ✅ arm64 路径默认不变(`DESKFOX_TARGET_ARCH` 缺省回落 `process.arch`;§0.5 仅 x64 触发)。

产物:`packages/desktop/dist-deskfox/DeskFox-2026.8.5-mac-x64.dmg`(325MB,sha256 `80422a56f664b9cab7f91b35cca2123149324183686a41cc3088c265bd78f2a8`)。

## 影响范围

- 仅新增 x64 交叉编译能力;arm64/prod 现有发布流程零行为变化(TC-7)。
- 未碰 updater / 发布链 / DB / HTTP 契约。

## 回退方法

`git revert` 本 feat commit。四文件改动均可逆:build/prepare/deskfox-config 为 fork 自有;`electron.vite.config.ts` 仅 3 行 env 注入 + 注释,revert 后回落 `process.arch`(原生行为)。

---

## R4 override 复核报告(`electron.vite.config.ts`)

> 命中 pre-commit §4.1 黑名单规则 `.*\.config\.(ts|js|mjs)$`(护上游配置;`.deskfox.config.*` 才豁免)。本季(Q3)R4 累计:REQ-069 + REQ-072 + 本笔 = **第 3 笔**,**已超健康基线 ≤2**。本报告即 R4 报备,待 user 审阅点头后 commit(commit 前不落地)。

### ① wrapper 不可行性(逐文件论证)

改动内容:`const nodePtyPkg = \`@lydell/node-pty-${process.platform}-${process.arch}\`` → 优先读 `process.env.DESKFOX_TARGET_ARCH`,缺省回落 `process.arch`。

为什么必须改这个上游文件、fork wrapper 走不通:

- **`nodePtyPkg` 的消费者全在本文件内**:它同时喂给 (a) `node-pty-narrower` 插件的 `resolveId`(把 `@lydell/node-pty` 重写成宿主子包)和 (b) `build.rollupOptions.externalizeDeps.include`。这两处都是 electron-vite 在**加载本 config 时**求值的内联逻辑,没有对外暴露的注入点或 hook 可供 fork-only 文件覆盖。
- **换 config 文件的方案更差**:electron-vite 通过 `bun run build`(package.json script)默认加载 `electron.vite.config.ts`。要走 fork 副本需 (i) 改 package.json script(也是黑名单)或加 `--config` 分叉,(ii) **整份复制**上游 config → 与上游形成长期双轨,每次 sync upstream 都要人肉对齐(违背「稳定 > 简洁」元原则,漂移风险远高于 3 行注入)。
- **改动已压到最小**:仅 1 行赋值改 + 5 行注释,新增变量 `targetArch`,不动插件、externalize、其余 config;带 `// FORK:` marker + `[feat:]` tag。属 R1「三级跳」第 2 级(上游 ≤5 行接口注入)的标准形态。

### ② 风险评估

- **默认行为零变化**:`DESKFOX_TARGET_ARCH` 未设时回落 `process.arch` —— 即上游原逻辑。arm64 原生打包(现有 prod 发布主路径)完全不受影响(TC-7 验)。
- **仅交叉打包路径生效**:只有 `build-deskfox-electron.sh --arch x64` 才 export 该 env。
- **可逆**:单点改,`git revert` 干净;无持久化/schema/契约变更。
- **上游 sync 风险低**:改动锚在 `nodePtyPkg` 单行,上游若重构此处,FORK marker 醒目、冲突可见即修。

### ③ 改动日志论证

见上方「根因 + 修法」「验证」段:该改动是 Intel x64 包能在真机启动的**充分必要条件之一**(N2 真凶),TC-3/TC-4/TC-6 直接验证其效果;无此改动则交付包 100% 在 Intel 上崩溃。

**结论**:wrapper 不可行(注入点在上游 config 内,副本方案造双轨),风险低(默认零变化 + 单点可逆),改动必要(修复真机崩溃的根因)。建议按 R4 single-person 流程,user 审阅本报告后点头 commit(commit message 挂 `[override-blacklist: REQ-081 交叉打包按目标 arch 选 node-pty 子包,注入点在上游 electron.vite.config.ts 内无 fork wrapper 可替代]`)。
