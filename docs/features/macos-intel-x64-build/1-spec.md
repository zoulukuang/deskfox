feat-id: macos-intel-x64-build
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# macOS Intel x64 安装包构建支持(REQ-081)

> 需求源:`OPENCODE-PLAN/需求计划/2026-07-11.md`(实代码核验后已订正,commit `107cff2`)。
> 规模:Medium(~76 行,4 文件,含 1 个上游黑名单文件 `electron.vite.config.ts`)。

## 需求

DeskFox 此前只出 macOS **arm64**(Apple Silicon)包。需支持在 Apple Silicon 开发机上**交叉编译**出可在 **Intel x64** Mac(含 Rosetta 2)上运行的签名 + 公证安装包,与 arm64 包**共享同一版本号**、独立文件名(`-mac-x64` / `-mac-arm64`)。

本期先交付**单独一个可手动下载安装的 x64 测试包**(不碰 updater 自动升级、不发布)。

## 验收标准

1. `build-deskfox-electron.sh -Env prod --sign --notarize --arch x64` 产出 `DeskFox-<版本>-mac-x64.dmg`。
2. 产物主二进制、内嵌 LibreOffice、node-pty 原生模块**全为 x86_64**。
3. 签名(Developer ID)+ 公证 + staple + Gatekeeper `accepted` 全通过。
4. **在真 Intel Mac 上安装启动成功**(不再报 `Failed to load native module: pty.node`)。
5. arm64 / prod 现有发布流程**零行为变化**(默认 arch 仍 arm64)。

## 架构选型 / 施工前钉死项

- **LO 版本**:x64 与 arm64 对齐 `25.8.7`,x64 落独立目录 `libreoffice-bundle/macos-x64/`,与 arm64(`macos/`)并存不覆盖。
- **产物命名**:`artifactName` 已含 `${arch}` → 自动产 `mac-x64` / `mac-arm64`,**架构不进版本号**(对齐《版本号与发布渠道规范》三维正交)。
- **updater(本期不做,仅记录订正)**:实读 `electron-updater@6.8.9` `MacUpdater.js` `filterFilesForArch` —— Mac 客户端**只请求单本 `latest-mac.yml`**,arch 分流靠 yml `files[]` 里 URL 是否含 `arm64`。故正解是**单本 yml 双 arch 合并 `files[]`**,不是独立 `latest-mac-x64.yml`(需求文档原方案已订正)。
- **关键技术风险(施工中发现,见 2-plan)**:node-pty 原生模块的**交叉打包**是本需求真正的难点,分两层:① x64 预编译包在 arm64 主机默认不安装;② electron-vite 打包时把**构建机架构**写死进 bundle。两层都修才能在 Intel 上跑通。

## 测试用例清单(R8)

| # | 验什么 | 层级 | 预期 |
|---|---|---|---|
| TC-1 | x64 LO bundle 落 `macos-x64/` 不覆盖 arm64 | 命令 + `file` | 两目录并存,soffice 各为对应架构 |
| TC-2 | build 产物主二进制架构 | `file` | x86_64 |
| TC-3 | app.asar 内 bundle import 的 node-pty 子包 | 字节 grep app.asar | 仅 `node-pty-darwin-x64`,0 处 arm64 |
| TC-4 | x64 node-pty 运行时可加载(native 风险点) | Rosetta 强制 `process.arch=x64` 实跑 `pty.spawn` | 加载 + spawn 成功 |
| TC-5 | 签名 / 公证 / staple / Gatekeeper | codesign / stapler / spctl | 全绿 accepted |
| TC-6 | **真 Intel Mac 安装启动**(CDP 自测 ≠ 真桌面) | 真机 QA | 启动成功,无 pty.node 崩溃 |
| TC-7 | arm64 build 回归(默认路径不变) | 未传 --arch 走 arm64 | 行为零变化 |
