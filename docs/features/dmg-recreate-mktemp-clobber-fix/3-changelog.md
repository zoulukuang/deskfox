feat-id: dmg-recreate-mktemp-clobber-fix
status: done
related: ./3-changelog.md

# 3-changelog — 修 macOS prod DMG 重建死在 step 5(hdiutil create "File exists")

## 规模

Tiny(1 行修复 + 注释,1 文件)。fork-only build 脚本,0 改上游,0 R4。

## 背景 / 复现

`/ship prod` 在步骤 3 打包时**每次必死在 build-deskfox.sh 的 "step 5: recreating DMG"**,日志无任何错误(因脚本里 `hdiutil create ... 2>/dev/null` 吞了 stderr + `set -e` 静默 abort)。

手动复现(stderr 露出)定位根因:
```
DMG_TMPIMG=$(mktemp /tmp/deskfox_rw_XXXXXX.dmg)   # → 返回字面 /tmp/deskfox_rw_XXXXXX.dmg
hdiutil create ... "$DMG_TMPIMG"                  # → "File exists" → exit 1 → set -e abort
```

**根因**:macOS BSD `mktemp` 只替换模板**结尾**的 `X`。模板 `deskfox_rw_XXXXXX.dmg` 因 `.dmg` 后缀,`X` 不在结尾 → BSD mktemp 不替换,当字面文件名,**创建 0 字节占位文件**并返回该路径。随后 `hdiutil create` 拒绝写已存在文件 → 死。每次必现(非 sandbox、非偶发);崩溃后字面占位文件残留,还会让后续 build 也 "File exists"(二次 brick)。

引入点:最近的 "proper DMG layout" 重建逻辑(commit `0b756753b` / `f1e86410d`),此前未真机 prod ship 验证过这条新路径。

## 改动

| 文件 | 改动 |
|---|---|
| `packages/branding/scripts/build-deskfox.sh` | recreate-DMG 段:`mktemp` 之后、`hdiutil create` 之前加 `rm -f "$DMG_TMPIMG"`(删占位文件让 hdiutil 新建;顺带自愈前次崩溃残留)。带注释说明 BSD mktemp 行为。 |

## 验证

手动复现脚本(= 本 bug 的 repro)加 `rm -f` 后全链路 exit 0:`hdiutil create` ✓ → `attach` 挂 `/Volumes/DeskFox` ✓ → `osascript` Finder 布局 ✓ → `detach` ✓ → `convert` 产出 234MB .dmg ✓。`bash -n` 语法通过。

## 影响范围

- 仅 macOS prod DMG 重建路径(LO bundle 重签后)。不改 app 二进制、不改产物内容,纯打包工具链。
- Win 端 build-deskfox.ps1 不产 dmg,无此问题,无需 parity。

## 回退

`git revert` 本 commit(删掉那行 `rm -f`)。无运行时状态。
