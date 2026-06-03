---
feat-id: lo-bundle
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# lo-bundle — LibreOffice 预捆绑安装包

## 背景与动机

当前 DeskFox 安装包不含 LibreOffice；用户第一次打开 .docx/.xlsx/.pptx 时触发运行时下载（355MB MSI）。
中国大陆用户网络下载成功率低，导致 Office 文档预览功能大量失效。

## 目标

将精简版 LibreOffice（仅保留 headless PDF 转换所需文件，≈100-150MB 未压缩）捆绑进 DeskFox Windows 安装包，用户安装后无需二次下载即可预览 Office 文档。

## 方案（C 方案）

- **bundle 准备**：`prepare-lo-bundle.ps1` 一次性脚本——下载 LO MSI → `msiexec /a` 提取 → 剥皮 → 写 `packages/branding/libreoffice-bundle/windows/`（不进 git）。
- **安装包打入**：`DeskFox.iss` 用 `FileExists` 条件编译，bundle 存在时将 `libreoffice\**` 打入 `{app}\libreoffice\`；卸载时同步删除。
- **运行时检测**：`office-installer.ts` 在 `detectSofficePath()` 中增加 bundled 路径（`path.dirname(process.execPath) / libreoffice / program / soffice.exe`），优先级仅次于 env var，比 state/PATH/common 都高。
- **不修改** `libreoffice.ts` 转换逻辑；现有下载/安装/onboarding 流程在无 bundle 时仍可 fallback。

## 剥皮策略（Windows）

提取后删除（对 headless PDF 转换无用）：
- `help\`（帮助文档）
- `share\gallery\`（剪贴画）
- `share\template\`（文档模板）
- `share\autotext\`
- `share\autocorrect\`
- `share\wordbook\`（拼写词典，最大，可达 200MB）
- `share\basic\`（Basic IDE）
- `share\xslt\`
- `presets\`
- `readmes\`

保留：`program\`、`share\registry\`、`share\filter\`、`share\extensions\`、`share\config\`、`share\Scripts\`、`share\uno_packages\`

## 测试用例（R8 清单）

- [ ] **U1**（unit）：`bundledSofficePath()` 返回 `<execDir>/libreoffice/program/soffice.exe` 格式路径
- [ ] **U2**（unit）：`detectSofficePath()` 在 bundled 路径存在时优先返回它，不查 state/PATH
- [ ] **U3**（unit）：`detectSofficePath()` 在 bundled 路径不存在时 fallback 到 state/PATH/common paths
- [ ] **U4**（unit）：bundled 路径命中时不写入 `office-tooling.json`（state 保持不变）
- [ ] **E1**（e2e/手动）：`prepare-lo-bundle.ps1` 运行完毕后 `soffice.exe` 在输出目录可找到
- [ ] **E2**（e2e/手动）：包含 bundle 的 installer 安装后，打开 .docx 文件直接渲染，无安装提示
- [ ] **E3**（e2e/手动）：不含 bundle 的 installer（bundle dir 不存在时）正常 build，onboarding 流程不变
- [ ] **E4**（e2e/手动）：卸载 DeskFox 后 `{app}\libreoffice\` 目录被删除

## 验收标准

1. `pack-installer.ps1` 在 bundle 存在时产出含 LO 的安装包，安装后无需下载即可渲染 Office 文档
2. `pack-installer.ps1` 在 bundle 不存在时正常产出安装包（仅输出 warn 提示）
3. 安装包体积增量 ≤ 150MB（LZMA2 压缩后 ≈50-80MB）
4. 零上游文件侵入（所有改动均在 fork-only 文件）

## 影响范围

| 文件 | 性质 | 改动 |
|------|------|------|
| `packages/opencode/src/file/office-installer.ts` | fork-only | 增加 bundled 路径检测 |
| `packages/branding/installer/DeskFox.iss` | fork-only | 条件包含 LO bundle |
| `packages/branding/scripts/pack-installer.ps1` | fork-only | bundle 存在性提示 |
| `packages/branding/scripts/prepare-lo-bundle.ps1` | fork-only 新增 | bundle 准备脚本 |
| `packages/branding/.gitignore` | fork-only | 忽略 bundle dir |
