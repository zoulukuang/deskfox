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

## Commit hash

待填写（commit 后补）
