feat-id: electron-icon-stale-fix
status: done
related: ./3-changelog.md

# Electron 打包 icon.ico 陈旧导致 256 校验失败 — 修复(Tiny / bug-repro)

## 现象(bug-repro)

`electron-builder --win`(NSIS)打包 **dev** 档时报错并中断:

```
⨯ Icon must be at least 256x256 pixels, provided: 128x128
  at doConvertIcon (app-builder-lib/src/util/iconConverter.ts)
  at WinPackager.resolveIcon → signAndEditResources(嵌入 exe 图标)
```

prod 档不受影响(prod/icon.ico 含 256)。

## 根因

- `electron-builder.deskfox.config.ts` 的 `win.icon` 直接引用 `packages/branding/src/assets/icons/<env>/icon.ico`。
- `icon.ico` 是 **gitignored 现场产物**。`build-deskfox-electron.ps1` 第 2 步历史逻辑是 **"仅当 icon.ico 缺失时"** 才用 `png-to-ico` 生成。
- 磁盘上残留了一份**旧 dev/icon.ico**(6/13 生成,最大仅 128x128),而 `dev/ico-source/256.png` 是 6/14 才补的 → 旧 ico 早于 256 源图。
- 构建时 ico **存在但陈旧** → "仅缺失才生成"的逻辑**静默复用**旧 128 ico → electron-builder NSIS 要求 icon ≥256x256 → 打包失败。
- **同类病**:与飞书 `dist/plugin.js` 陈旧(`build-deskfox-electron.sh` 只查存在不查新鲜度)是同一反模式。

## 修复

`packages/branding/scripts/build-deskfox-electron.ps1` 第 2 步:**"仅缺失才生成" → "每次从 ico-source 全量重新生成"**,并加校验:

- 移除 `if (-not (Test-Path $icoOut))` 守卫 → 无条件重生成,杜绝陈旧 ico 复用。
- 新增校验:`ico-source` 必须含 ≥256 的 `<size>.png`,否则 `throw`(electron-builder NSIS 硬要求,失败前置暴露而非打包中途崩)。
- 日志打印实际打进 ico 的尺寸列表,便于排查。

## 改动文件

| 文件 | 改动 | 行数 |
|---|---|---|
| `packages/branding/scripts/build-deskfox-electron.ps1` | icon.ico 每次重生成 + ≥256 校验 | ~+8 / -3 |

> `.sh`(macOS 版)对 `icon.icns` 也有同样的"仅缺失才生成"守卫(line 66),但 icns 是 **committed**(生命周期不同,Mac 无此报错)→ 本次不动,留作 Mac 侧建议(若 icns 需随源更新,同样改为重生成 + 重 commit)。

## 验证

- 按新逻辑重生成 `dev/icon.ico` → 含 6 尺寸(16/32/48/64/128/**256**)。
- `electron-builder --dir --win` 完整跑通:**越过 icon 嵌入步骤**(曾在此中断)→ 签名 `DeskFox Dev.exe` + 资源全过 → win-unpacked exe 新鲜产出(231MB)。256 错误消除。
- `.ps1` 语法 `PSParser.Tokenize` 通过。

## 回退方法

撤回 `build-deskfox-electron.ps1` 第 2 步改动即可(单点)。icon.ico 为 gitignored 产物,不入库。
