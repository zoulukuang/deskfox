feat-id: viewer-selection-tray-style
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 文件查看器选区高亮统一 + 托盘图标 mac template

## 背景(user 报告 3 项)

1. **托盘图标**:logo 在 mac 菜单栏图标偏大,且是品牌蓝固定色 —— 要求像其他菜单栏图标一样
   **白色自适应 + 缩小**。
2. **HTML 预览**:选中文字 → 右键"加入聊天"弹窗出现后,选中文字底色变**灰**(其他格式不灰)。
3. **CSV 预览**:选中文字 → 在选中处右键 → 被选中文字底色**消失**。

核心诉求:文件查看器里所有"能选中加聊天"的格式,**选中底色 + 加入聊天后的样式统一一致**。
user 拍板:**统一标准蓝**(用自绘 overlay 实现,失焦不变灰、右键不消失)。

## 现状根因(调研结论)

| 格式 | 渲染 | 选中高亮 | 右键加聊天后 |
|---|---|---|---|
| Markdown / 代码 | light / Pierre shadow | 原生蓝 + overlay 红 | 正常(蓝+红) |
| PDF / Office | Pierre shadow | 隐藏原生、纯 overlay 红 | 正常(纯红) |
| **HTML** | **iframe(localasset://)** | iframe 内原生蓝 | **变灰**(iframe 失焦 + 父文档没画 overlay) |
| **CSV** | light(CSS grid) | 原生蓝、不画 overlay | **消失**(右键 collapse + 没 overlay 兜底) |

- overlay(`setSelectionHighlight`)是跨 shadow 的自绘高亮,原色 `rgba(209,52,56,0.5)` 微软红,仅右键时画。
- HTML 灰:iframe 失焦后浏览器把原生选区渲染成灰(UA 默认),postMessage 只传 text 没传选区坐标 → 父文档无法画 overlay 补偿。
- CSV 消失:故意不画 overlay(grid `getClientRects` 整行铺满 → viewport-fixed overlay 溢出文件树/聊天),只靠原生选区,但右键 collapse + grid 几何使原生高亮常断裂/消失。

## 方案(统一标准蓝)

- **overlay 颜色** 微软红 → GitHub 蓝 `rgba(56,139,253,0.4)`(与原生 ::selection 同系,拖选↔右键无缝)。
- **CSV**:右键改为画 overlay 蓝,并**裁到 CSV 容器矩形**(`clampRectsToBounds`)防 grid 矩形溢出。
- **HTML iframe**:桥接脚本 contextmenu 时多传选区 `rects`(相对 iframe viewport)+ 注入蓝 `::selection`;
  父文档 postMessage handler 用 `projectIframeRects` 加 iframe offset 投影成 overlay 蓝 → 治失焦变灰。
- **托盘**:tray.ts 平台分支 —— mac 用纯黑 alpha template image(`setTemplateImage(true)` 系统按明暗反色,
  暗菜单栏显白)+ 32px@2x = 16pt 逻辑尺寸(缩小);Win/Linux 保留品牌蓝彩色(template 在 Win 不反色发暗)。

## 影响文件(全 fork-only,无上游/黑名单)

- `packages/app/src/pages/session/file-tabs.tsx`(overlay 颜色 + CSV 画 overlay + HTML 投影)
- `packages/app/src/pages/session/selection-overlay.ts`(新增:clampRectsToBounds / projectIframeRects 纯函数)
- `packages/desktop/src/main/deskfox/local-asset.ts`(iframe 桥接脚本:传 rects + 注入蓝 ::selection)
- `packages/desktop/src/main/deskfox/tray.ts`(mac template 平台分支)
- `packages/branding/src/assets/tray-icons/source/tray-template-mac-{16,32}.png`(新增纯黑 template)

## 测试用例清单(R8,动工前列;视觉项靠真机目测)

### 单元(纯函数,bun:test)
- [x] `clampRectsToBounds`:界内不变 / 超右裁宽 / 超左裁 / 超下裁 / 全界外丢弃 / 多矩形混合 / 空输入
- [x] `projectIframeRects`:加偏移 / 零偏移 / 宽高不受偏移 / 空数组
- [x] `local-asset` injectContextmenuBridge 既有 5 例不被桥接脚本改动破坏(style 置于 script 后,startsWith 不变)

### 真机目测(GUI,本 feat 主验收 —— "CDP 自测 ≠ 真桌面 QA")
- [ ] 托盘:暗色菜单栏显**白色** fox、尺寸不偏大;亮色菜单栏显黑;Win 仍蓝(同事验)
- [ ] Markdown:拖选蓝 / 右键加聊天后蓝(不变色)
- [ ] 代码文件:拖选蓝 / 右键后蓝
- [ ] PDF / Office:右键后蓝(原为红)
- [ ] **HTML**:拖选蓝 / 右键加聊天后**仍蓝、不变灰**
- [ ] **CSV**:拖选蓝 / 右键加聊天后**仍蓝、不消失、不溢出**到文件树/聊天
- [ ] 各格式菜单关闭后选区高亮干净消失
