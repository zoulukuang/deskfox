feat-id: dev-channel-icon-lowres
status: done
related: ./3-changelog.md

# dev/local 档图标低清修复(Tiny)

> 2026-08-18。起因:user 看 Dock 截图问「local 版 logo 为什么长这样」。
> 排查发现**两件事,一件是误会、一件是真问题**。

## ① 误会:Dock 里那个方块是 Electron 默认图标,不是 DeskFox 图标

当时 local 版是**裸 Electron 直接加载构建产物**跑起来的(为绕开 `desktop-build-blockers` 的打包阻塞):

```
node_modules/.bun/electron@42.3.3/.../Electron.app/Contents/MacOS/Electron
```

Dock 图标取自**正在运行的 app bundle**,那就是 `node_modules` 里的 `Electron.app` → 显示 Electron 自己的图标。
品牌图标是 electron-builder **打包时**注入 `.app/Contents/Resources/icon.icns` 的,裸跑压根没这一步。
**没有任何地方"把 logo 换掉了"。**

## ② 真问题:dev 档(local 共用)图标源缺 512/1024,icns 封顶 128×128

| 渠道 | icon.icns | 最大分辨率 | ico-source 有 512/1024 |
|---|---|---|---|
| prod | 138 KB | 1024×1024 | ✅ |
| beta | — | — | ✅(源图齐全) |
| **dev**(local 也用它) | **8.5 KB** | **128×128** | ❌ **两个都缺** |

外加 `dev/128x128@2x.png` 实际只有 128px 宽(按命名应为 256),@2x 资源是假的。

**根因**:`png-to-icns.sh` 用 `copy_if_exists` 从 `ico-source/<size>.png` 拼 iconset,
**缺哪档就静默跳过**。dev 少了 512/1024 两张源图,于是 icns 一路静默封顶,
直到 user 肉眼发现才暴露 —— 典型的静默降级。

> local 用 dev 的图标是设计如此:`electron-builder.deskfox.config.ts:68`
> `const iconEnv = channel === "prod" ? "prod" : "dev"`。所以 dev 糊 = local 也糊。

## 修法

1. **回矢量源重生成**,不是把 256 放大(放大只会糊得更均匀)。
   `packages/branding/src/logo.tsx` 的 `MarkFavicon` 就是 dev 档那个「极简 5 元素」变体
   (viewBox 64×64 纯路径 + 圆角底),可无损渲染到任意尺寸。
   新增 `packages/branding/scripts/gen-dev-icons.mjs`:用仓内已有的 playwright/chromium 栅格化,
   一次产出 16/32/64/128/256/512/1024,写回 `ico-source/` 与三张散图。**不引入新依赖**。
2. **补齐被 git 跟踪的源图** —— `icon.icns` / `icon.ico` 是 gitignored 的构建期产物,
   所以持久修复必须落在 `ico-source/`(已跟踪)。补进 `512.png` / `1024.png`,
   并把 `128x128@2x.png` 修正为真正的 256px。
3. **把静默跳过变成显式警告**(`png-to-icns.sh`):缺档时列出缺了哪些;
   缺 512/1024 时额外点明「Retina 会糊」并给出重生成命令。

## 验证

- 重生成后 dev icns:**8.5 KB / 128×128 → 113 KB / 1024×1024**;`128x128@2x.png` → 256px。
- 视觉比对:造型/配色与原图一致(蓝狐 + 深底圆角),只是变锐利 —— 不是换了图。
- **删掉 icns 后从被跟踪的源图重建,仍得 1024** → 证明修复不依赖本地产物,他人 clone 即生效。
- 端到端:`electron-builder --mac --dir` 重打 local 包,
  `DeskFox 本地版.app/Contents/Resources/icon.icns` = 113 KB / 1024×1024。
- 反向验证:构造缺 512/1024 的源目录,警告按预期触发并给出修法。
- typecheck 29/29。

## 影响面 / 回退

- 改动:1 个新脚本 + 1 个脚本加警告 + dev 档源图刷新(8 改 2 增)。均在 `packages/branding/`
  (R3 规定的 fork 自有图标目录),不触黑名单、无需 R4。
- **prod 图标一个字节没动** —— 你在用的正式版外观不受影响。
- 回退:`git revert` 本笔即可;回退后 dev/local 图标退回低清,不影响功能。

## 待办(未做)

- `beta` 档源图齐全但**没有 128x128@2x.png 等散图**,且当前无 `icon.icns` 产物;
  beta 日常不 ship(见 CLAUDE.md),暂不处理,记此备查。
