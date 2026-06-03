---
feat-id: lo-bundle-macos
status: in-progress
related: ./1-spec.md ./3-changelog.md
---

# lo-bundle-macos — LibreOffice 预捆绑 macOS 适配

## 背景

lo-bundle(Windows) 已实测落地:DeskFox Windows 安装包含 LO 25.8.7,用户安装即可预览 Office 文档。
本 feat 对称实现 macOS 端——将精简版 LibreOffice 打入 DeskFox.app,无需用户二次下载。

## 版本要求

使用与 Windows **相同的稳定线版本:LibreOffice 25.8.7 (Still)**
`office-installer.ts LIBREOFFICE_VERSION = "25.8.7"` — 已统一。

## 方案

### bundle 准备（一次性，开发机执行）

`prepare-lo-bundle.sh`:
1. 下载 LO 25.8.7 macOS arm64 DMG(同 Windows,使用国内镜像列表)
2. `hdiutil attach` 挂载 DMG
3. `cp -R LibreOffice.app` 到 staging
4. `hdiutil detach` 卸载
5. 剥皮:删 help/gallery/template/autocorrect/wordbook/basic/xslt/presets/wizards/Java JDK
   (同 Windows 策略;extensions 目录保留骨架,避免 soffice profile fatal error)
6. `codesign --remove-signature` 清除 LO 原有签名(让 Tauri 统一重签)
7. 输出到 `packages/branding/libreoffice-bundle/macos/LibreOffice.app`

### .app 打包（build-deskfox.sh 自动处理）

`build-deskfox.sh` 在 `tauri build` 前检测 bundle:
- **存在** → 动态注入额外 `--config '{"bundle":{"resources":{...}}}'`,Tauri 将 LO 打入 `.app/Contents/Resources/libreoffice/`
- **不存在** → 打印警告,继续正常构建(用户仍可运行时下载)

### 运行时检测（office-installer.ts）

`bundledSofficePath()` 新增 darwin 分支:
```
process.execPath = DeskFox.app/Contents/MacOS/opencode-cli (Tauri sidecar 位置)
bundled soffice  = DeskFox.app/Contents/Resources/libreoffice/Contents/MacOS/soffice
                 = path.resolve(dirname(execPath), "../Resources/libreoffice/Contents/MacOS/soffice")
```

优先级(同 Windows):env var > bundled > state > PATH > common paths。
bundled 命中时不写 state,`status()` 不报 downloadSizeMB。

## 剥皮体积预估（macOS vs Windows）

| 阶段 | macOS | Windows |
|---|---|---|
| DMG/MSI 原始 | ~280MB | ~355MB |
| 提取后 | ~700MB | ~1456MB |
| 剥皮后（预估） | ~300-400MB | 636MB |
| .app 压缩后增量（预估） | +100-150MB | +123MB |

## 测试用例（R8 清单）

- [ ] **U1**: `bundledSofficePath()` on darwin 返回 `<execDir>/../Resources/libreoffice/Contents/MacOS/soffice`
- [ ] **U2**: `detectSofficePath()` bundled 路径存在时优先返回,不查 state/PATH
- [ ] **U3**: `detectSofficePath()` bundled 路径不存在时 fallback 到 state/PATH/common
- [ ] **U4**: bundled 命中时 `status().downloadSizeMB` 为 undefined
- [ ] **E1**: `prepare-lo-bundle.sh` 执行完毕后 `LibreOffice.app/Contents/MacOS/soffice` 可执行
- [ ] **E2**: `prepare-lo-bundle.sh` 剥皮后体积 < 600MB
- [ ] **E3**: 含 bundle 的 `build-deskfox.sh -Env dev` 产出的 `.app` 内有 `Resources/libreoffice/`
- [ ] **E4**: 不含 bundle 时 build 正常(降级,仅打印 warning)
- [ ] **E5**: 含 bundle 的 `.app` 打开 .docx 文件可直接渲染,无下载提示

## 影响范围

| 文件 | 性质 | 改动 |
|---|---|---|
| `packages/opencode/src/file/office-installer.ts` | fork-only（黑名单误伤）| bundledSofficePath/detectSofficePath/status macOS 支持 |
| `packages/branding/scripts/build-deskfox.sh` | fork-only | 检测 LO bundle,条件注入 Tauri --config |
| `packages/branding/scripts/prepare-lo-bundle.sh` | fork-only 新增 | macOS bundle 准备脚本 |

## 注意事项

1. **代码签名**:prepare-lo-bundle.sh 会清除 LO 原有签名。Tauri prod build 会对整个 .app 包括内嵌的 LO 统一重签。dev build 无签名,macOS Gatekeeper 通过右键→打开可绕过。
2. **arm64 only**:默认构建 arm64(Apple Silicon)。Intel Mac 通过 `-Arch x86_64` 生成对应 DMG。
3. **Tauri resources 路径**:相对于 `packages/desktop/src-tauri/`,故路径为 `../../../../branding/libreoffice-bundle/macos/LibreOffice.app`。
