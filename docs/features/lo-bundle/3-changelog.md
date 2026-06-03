---
feat-id: lo-bundle
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 3-changelog — lo-bundle

## 改动文件

| 文件 | 行数 | 性质 |
|------|------|------|
| `packages/opencode/src/file/office-installer.ts` | +24 | fork-only 修改 |
| `packages/branding/installer/DeskFox.iss` | +14 | fork-only 修改 |
| `packages/branding/scripts/pack-installer.ps1` | +12 | fork-only 修改 |
| `packages/branding/scripts/prepare-lo-bundle.ps1` | +102 | fork-only 新增 |
| `packages/branding/.gitignore` | +3 | fork-only 修改 |
| `docs/features/lo-bundle/1-spec.md` | +65 | 文档新增 |
| `docs/features/lo-bundle/3-changelog.md` | 本文 | 文档新增 |

## 核心逻辑

### 1. `office-installer.ts` 改动

新增 `bundledSofficePath()`:
```typescript
function bundledSofficePath(): string {
  if (process.platform !== "win32") return ""
  return path.join(path.dirname(process.execPath), "libreoffice", "program", "soffice.exe")
}
```

`detectSofficePath()` 中在 env var 检测之后、state 检测之前插入 bundled 检测：
- bundled 路径命中时 **不写 state**（路径由安装决定，无需持久化）
- `ToolingStatus` 新增 `bundled?: boolean` 字段
- `status()` 中 bundled 时 `downloadSizeMB` 设 `undefined`（无需下载）

### 2. `DeskFox.iss` 改动

```iss
#define LoBundleDir "..\libreoffice-bundle\windows"
#if FileExists(LoBundleDir + "\program\soffice.exe")
  #define LoBundled 1
#endif

; [Files] 段新增:
#ifdef LoBundled
Source: "{#LoBundleDir}\*"; DestDir: "{app}\libreoffice"; Flags: ignoreversion recursesubdirs createallsubdirs
#endif

; [UninstallDelete] 段新增:
#ifdef LoBundled
Type: filesandordirs; Name: "{app}\libreoffice"
#endif
```

bundle 不存在时 `LoBundled` 未定义，`.iss` 静默跳过，installer 正常 build。

### 3. `pack-installer.ps1` 改动

ISCC 编译前插入 bundle 状态检测，输出 ✓（已就绪/大小）或 ⚠（未准备/降级说明）。

### 4. `prepare-lo-bundle.ps1`（新增）

完整的一次性开发工具脚本：
- 镜像列表与 `office-installer.ts` 同步（清华/中科大/北外/南大/TDF 官方）
- BITS 传输（断点续传）→ fallback 到 Invoke-WebRequest
- `msiexec /a` 提取（需管理员权限）
- `Get-ChildItem -Filter soffice.exe -Recurse` 自适应 LO 目录结构
- 剥皮：删 help / gallery / template / autotext / autocorrect / wordbook / basic / xslt / presets / readmes
- 输出到 `packages/branding/libreoffice-bundle/windows/`

## 回退方法

删除 `packages/branding/libreoffice-bundle/`，再次 pack installer 即得不含 LO 的原始体积安装包。
代码改动可通过 git revert 单独回退（4 个文件改动可单独回退）。

## 实测落地（2026-06-03，user 拍板 25.8.7 稳定线）

### 版本选择
绑定 **LibreOffice 25.8.7**（Still 稳定线最新），非默认 26.2.x Fresh 线 —— user 求稳优先。`prepare-lo-bundle.ps1` 默认 `-Version` 改为 25.8.7。

### 体积实测
- 原始 `msiexec /a` 提取：**1456 MB**（远超预期，完整 LibreOffice 体量）
- 剥皮后：**636 MB** 未压缩
- 剥掉 820 MB：拼写词典(extensions) 460 + 多语言 UI 翻译(resource 非 common) 264 + UI 图标主题(config images) 71 + help/template/gallery/wizards 等 51
- **安装包实测**（ISCC `LZMA2/max` + `SolidCompression`，实编 prod 安装包验证）：
  - 基线（不含 LO）：**60 MB**
  - 含 LO：**183 MB**，净增 **123 MB**
  - 636 MB → 123 MB，**压缩率仅 19%** —— solid 压缩对 LibreOffice 大量相似 `*lo.dll` 消重极有效，远好于单文件压缩的 ~50%
  - 增量 123 MB **小于**用户原本在线下载的 349 MB MSI（剥皮 + solid 压缩双重作用）

### 转换功能验证（用剥皮后 bundle 的 soffice，default profile）
| 测试 | 结果 |
|------|------|
| Word doc1.docx | ✅ 31KB → PDF 127KB |
| Excel sheet1.xlsx | ✅ 9KB → PDF 325KB |
| PowerPoint slide1.pptx | ✅ 49KB → PDF 1.2MB |
| 中文 CJK 渲染 | ✅ 正常（字体未删坏）|
| 320MB 大 pptx（海量图片）| ✅ 316MB → PDF 294MB / 19s |

### 4 条踩坑沉淀（重要）
1. **PS5.1 读 UTF-8 脚本乱码** —— Write 工具写的 `.ps1` 无 BOM，Windows PowerShell 5.1 按 GBK 解码中文/emoji，字符串引号配对破坏 → 解析失败。修：emoji 换 ASCII + `.NET WriteAllText(UTF8Encoding($true))` 加 BOM。脚本头注释已标明此约束。
2. **share\extensions 整删致命** —— 整个删除 extensions 目录 → soffice 首次创建 user profile 报 `Fatal Error: User installation could not be completed`（且 `--headless` 下仍弹 GUI 框，因失败发生在 bootstrap 早期）。修：删子目录内容（460MB 词典）但**保留 extensions 目录骨架**。
3. **-env:UserInstallation 测试假象** —— 自测时为隔离 profile 加了 `-env:UserInstallation=file:///...`，格式问题导致同样的 fatal error，一度误判剥皮删坏。真实代码 `libreoffice.ts` 不带此参数（用 default profile）。教训：测试命令应照搬生产参数，勿引入额外变量。
4. **中文路径 PowerShell 传参编码** —— PS5.1 `Start-Process` 给 native soffice 传中文路径参数按 ANSI 丢字符 → `source file could not be loaded`。生产走 Bun `Process.run`（宽字符 API）不受影响。自测改用 ASCII 文件名验证。

### prepare-lo-bundle.ps1 二次改动
- 默认 `-Version` 26.2.2 → 25.8.7
- 管理员检查从硬 throw 放宽为 warn（`msiexec /a` 提取实测非管理员可成功）
- extensions 从"整目录删"改为"删内容留骨架"
- 全文 emoji → ASCII + UTF-8 BOM

## Commit hash

- `934c964a0` —— 首笔（office-installer 检测 + iss 条件编译 + 脚本初版 + 文档）
- 待填写 —— 二笔（prepare-lo-bundle.ps1 实测修正 + changelog 落地）
