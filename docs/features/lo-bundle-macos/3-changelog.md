---
feat-id: lo-bundle-macos
status: in-progress
related: ./1-spec.md ./3-changelog.md
---

# 3-changelog — lo-bundle-macos

## Commit 1: macOS LO bundle 适配基础实现

**commit**: (待填)
**分支**: `feat/lo-bundle-macos`
**规模**: ~150 行净代码(3 文件改 + 1 新增)

### 改动文件

| 文件 | 类型 | 改动说明 |
|---|---|---|
| `packages/opencode/src/file/office-installer.ts` | fork-only（黑名单误伤）| `bundledSofficePath()` 加 darwin 分支;`detectSofficePath()` 和 `status()` bundled 检测加入 darwin |
| `packages/branding/scripts/build-deskfox.sh` | fork-only | 步骤 1.9:检测 LO bundle 存在性,条件注入 Tauri `--config` resources |
| `packages/branding/scripts/prepare-lo-bundle.sh` | fork-only 新增 | macOS bundle 准备脚本:下载 25.8.7 DMG → 挂载 → 剥皮 → 清除签名 |
| `docs/features/lo-bundle-macos/1-spec.md` | 文档新增 | |

### 关键设计决策

- **版本**: LO 25.8.7 Still 稳定线,与 Windows 保持一致(同一个 `LIBREOFFICE_VERSION` 常量)
- **bundle 路径**: `DeskFox.app/Contents/Resources/libreoffice/` = LibreOffice.app 重命名后放入 Tauri resources
- **soffice 路径**: `../Resources/libreoffice/Contents/MacOS/soffice`(相对于 sidecar execPath `Contents/MacOS/opencode-cli`)
- **条件打包**: build-deskfox.sh 检测 bundle 目录,存在则追加 `--config JSON` 给 Tauri;不存在则降级(warning + 正常 build)
- **签名策略**: prepare 脚本清除 LO 原有签名 → Tauri prod build 统一重签整个 .app
- **剥皮策略**: 同 Windows(help/gallery/template/autocorrect/wordbook/basic/xslt/presets/wizards/JDK)

### R4 override 论证（`office-installer.ts` 黑名单）

同 Windows lo-bundle 的 override 论证:该文件是 fork 新建 office→PDF 功能(上游 opencode 无此文件),黑名单按 `packages/opencode/` 路径前缀系统性误伤。改动 = 2 处新增 `process.platform === "darwin"` 条件 + `bundledSofficePath()` 新增 darwin 分支;不改核心检测/转换逻辑,可单独 revert。本季连续同类误伤(第 4 笔)。

### 测试结果

- typecheck 17/17 通过
- E1~E5 手动 QA 待运行(需先执行 prepare-lo-bundle.sh 准备 bundle)
