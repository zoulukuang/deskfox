feat-id: viewer-selection-tray-style
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 改动日志

## 改动文件(全 fork-only,0 上游侵入 / 0 R4)

| 文件 | 类型 | 说明 |
|---|---|---|
| `packages/app/src/pages/session/selection-overlay.ts` | 新增 | `clampRectsToBounds`(CSV 裁剪)/ `projectIframeRects`(HTML 投影)纯函数 |
| `packages/app/src/pages/session/selection-overlay.test.ts` | 新增 | 11 例单测覆盖两纯函数 |
| `packages/app/src/pages/session/file-tabs.tsx` | 改 | overlay 红→蓝;setSelectionHighlight 加裁剪参数;CSV 画 overlay 蓝(裁剪);HTML postMessage 投影 overlay 蓝 |
| `packages/desktop/src/main/deskfox/local-asset.ts` | 改 | iframe 桥接脚本:contextmenu 传选区 rects + 注入蓝 ::selection |
| `packages/desktop/src/main/deskfox/tray.ts` | 改 | mac template image 平台分支(纯黑 alpha + setTemplateImage + @2x 缩小) |
| `packages/branding/src/assets/tray-icons/source/tray-template-mac-{16,32}.png` | 新增 | 纯黑 fox template(resvg 由 SVG fill=#000 生成) |

## 关键改动

### 选区统一蓝
- overlay 色 `rgba(209,52,56,0.5)` 红 → `rgba(56,139,253,0.4)` 蓝(file-tabs.tsx 渲染处 + 注释)。
- `setSelectionHighlight(range, clipRect?)` 新增可选裁剪:`clipRect` 时用 `clampRectsToBounds` 裁到容器内。
- **CSV**:`handleCsvContextMenu` 原 `setSelectionHighlight(null)` → `setSelectionHighlight(range, csvBounds)`
  (csvBounds = 右键容器 `getBoundingClientRect`),既画蓝又裁剪防 grid 矩形溢出。
- **HTML**:桥接脚本 contextmenu 传 `rects`(iframe viewport 坐标)+ iframe 内 `<style>::selection 蓝`;
  父 postMessage handler 校验后 `projectIframeRects` 投影 → `setHighlightRects` 画 overlay 蓝(治失焦灰)。

### 托盘 mac template
- tray.ts `createTray` 平台分支:`darwin` → `TRAY_ICON_MAC_TEMPLATE_BASE64`(纯黑 32px)`createFromBuffer(..,{scaleFactor:2})`
  = 16pt 逻辑 + `setTemplateImage(true)`;其他平台保留 `TRAY_ICON_PNG_BASE64` 彩色蓝。

## 验证

- 单测:selection-overlay 11 pass;local-asset 既有 5 pass(桥接脚本改动未破坏)。
- typecheck:monorepo 26/26 全过。
- 完整 build dev:产物 `DeskFox-Dev-2026.6.0-mac-arm64`(.dmg/.zip/.app)。
- 真机逐格式目测:见下「真机验证」段(待 user 确认)。

## 真机验证(R9)

**user 真机测试通过(2026-06-14)**:
- 🦊 托盘:暗色菜单栏白色 fox + 大小合适(agent 菜单栏截图 self-check + user 确认)
- Markdown / 代码 / PDF / Office:拖选 + 右键加聊天统一蓝
- HTML:右键加聊天后蓝色,**不再变灰**
- CSV:右键后蓝色,**不消失、不溢出**到文件树/聊天

## commit

- `6dcd3686a5` fix(tray): macOS 托盘 template image(白色自适应 + 缩小)
- 选区统一蓝 + 本三文档:同一提交(file-tabs.tsx / selection-overlay.ts(+test) / local-asset.ts)

## 回退

各改动 fork-only,可 `git revert`;overlay 颜色/CSV/HTML/托盘相互独立。
