feat-id: libreoffice-user-install-fail-win
status: in-progress
related: ./3-changelog.md

# 内置 LibreOffice 在干净机器上「User installation could not be completed」修复

> 规模:Tiny(两个 prepare 脚本各删一行 `presets`),但落地链路长(重做 bundle → 重打包 → 重发版)
> 分支:`fix/libreoffice-user-install-fail-win`
> 起源:2026.7.0 prod 发版后,多台 Windows 干净机器装完用文档功能即报 LibreOffice fatal error

## 一、Bug 现象

DeskFox 调内置 LibreOffice 转文档时,**干净机器 100% 弹**:
```
LibreOffice 25.8 - Fatal Error
The application cannot be started.
User installation could not be completed.
```
打包机不报(因早装过完整 LO,`%APPDATA%\LibreOffice\4` 已有现成 profile)。

## 二、根因(Win/Mac 双端实测闭环)

**内置 LibreOffice 的 `presets/` 目录被剥皮脚本整个删除。** LibreOffice 首次为新用户创建配置目录时,正是从 `presets/`(autotext/basic/config/database/gallery,仅 ~200KB)拷初始模板;删光 → profile 初始化失败 → 此 fatal error。

证据链:
- **Mac 端 A/B/C 对照**(同事实测):A 完整 LO + 全新 profile → ✅ 退 0 产 PDF(证明在剥皮不在参数);B 剥皮 bundle + 全新 profile → ❌ 退 77 同错;C 剥皮 bundle **+ 加回 presets** + 全新 profile → ✅ 退 0 产 PDF(单变量锁定 presets)。
- **Win 端复现 + 验证**(本机实测):剥皮 bundle + 显式可写纯英文全新 profile → ❌ 同错(排除参数/路径/权限/中文路径);拷回 presets 后同条件 → ✅ 产出 t.pdf 13793 bytes,无错误。
- **代码实锤**:`prepare-lo-bundle.ps1:140` / `prepare-lo-bundle.sh:151` 的删除清单都含 `presets`(整删)。

**为什么 2026.7.0「修了 extensions 还报」**:2026-06-03 第二轮剥皮只把 `extensions` 改成"留骨架",presets 是第二个被删的必需目录,一直没补 → Win 端 extensions 修复后仍必现。两端同病同因。

## 三、修复

两个 prepare 脚本的删除清单各去掉 `presets`(代价 ~200KB,可忽略),保留即修复。

| 文件 | 改动 |
|---|---|
| `packages/branding/scripts/prepare-lo-bundle.ps1` | `$stripFolders` 去掉 `"presets"` + 加保留原因注释 |
| `packages/branding/scripts/prepare-lo-bundle.sh` | `STRIP_DIRS` 去掉 `"presets"` + 加注释 |

bundle 本身 gitignored:Win 端已本地把 presets(166KB,取自本机完整 LO 25.8.x)拷回 `libreoffice-bundle/windows/presets`;canonical 做法是改完脚本后重跑 `prepare-lo-bundle.ps1` 重做 bundle(下次会自动保留 presets)。

## 四、验证

- Win 端 C 实验:bundle + presets + 全新空 profile → soffice `--convert-to pdf` 退出成功、产出 PDF ✓(无 fatal error)。
- Mac 端同事 A/B/C 已实测验证。
- 单元测试不适用(需真跑 soffice + 真 profile bootstrap,纯 build-script/品牌资源改动,R5 Tiny 例外);验证以双端真机 C 实验为准。

## 五、落地链路(待办)

改脚本(✅ 本 commit)→ 两端各重跑 prepare-lo-bundle 重做 bundle → 重新打包 → 重发版(建议 **2026.7.1 hotfix**,因 2026.7.0 在所有干净机器上文档功能不可用)。Win 端 by 本机;Mac 端 by 同事。

## 六、回退

`git revert` 单 commit(脚本)。bundle 回退 = 重跑旧脚本(但那会再删 presets,不应回退)。
