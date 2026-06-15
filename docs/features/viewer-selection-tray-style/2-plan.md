feat-id: viewer-selection-tray-style
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实施计划 + 决策轨迹

## 决策:统一目标视觉 = 标准蓝 overlay(user 拍板)

调研发现各格式本就不统一(md/代码=蓝+红、pdf=纯红、html=灰、csv=无)。给 user 三选项
(统一蓝 / 统一红 / 只修 html+csv),user 选**统一标准蓝**:用自绘 overlay 实现,因 overlay 不依赖
窗口焦点 → 根治 HTML iframe 失焦变灰 + CSV 右键消失,且最贴近系统选区习惯。

## 决策:overlay 改蓝而非隐藏原生 / 移除 addRange

- overlay 颜色直接红→蓝(`rgba(56,139,253,0.4)`),与原生 ::selection 同系。
- **保留**各 handler 现有 addRange 恢复原生逻辑(降风险):md/代码右键后是"原生蓝+overlay蓝"双层,
  pdf/csv/html 是 overlay 蓝单层。深浅有细微差但都是蓝,大方向统一。若真机觉得双层过深,后续再调
  (移除 addRange 改单层,或降 alpha)。不在首版冒险移除 addRange(影响所有格式,风险集中)。
- index.css 暂不动(不强改各格式拖选原生色 + 不碰 PDF 的 transparent 规则,降回归风险);拖选阶段
  各格式原生蓝已基本一致,用户抱怨集中在"右键后",overlay 蓝已覆盖该场景。

## 决策:CSV overlay 裁剪而非继续不画

原方案不画 overlay(怕 grid 矩形溢出),但导致右键后消失。改为画 overlay + `clampRectsToBounds`
裁到 CSV 容器矩形(`event.currentTarget.getBoundingClientRect()`)→ 既统一蓝又不溢出。
裁剪是纯函数,单测覆盖边界(超左/右/下/全界外)。

## 决策:HTML iframe 投影(跨文档 overlay)

iframe 内 range 在父文档无法直接 getClientRects(跨文档)。方案:桥接脚本在 iframe 内算好选区
rects(相对 iframe viewport)随 postMessage 传出,父文档加 `iframe.getBoundingClientRect()` 偏移投影
(`projectIframeRects`)→ overlay 蓝盖在 iframe 失焦的灰选区上。iframe 内同时注入蓝 ::selection 统一拖选色。

## 决策:托盘 mac template 用 @2x scaleFactor

mac 菜单栏图标规范 = template image(纯黑 alpha,系统按明暗反色)。用 `createFromBuffer(buf32, {scaleFactor:2})`
让 32px 当 @2x = 16pt 逻辑尺寸(Retina 清晰 + 缩小,原 32 偏大)+ `setTemplateImage(true)`。
Win/Linux 保留品牌蓝彩色(README 记载:纯黑 template 在 Win 托盘不反色发暗,2026-06-13 才改的彩色)。
纯黑 template PNG 由 `icon-tray-template.svg`(fill 改 #000)经 resvg 生成,内联 base64。

## 验证策略

- 单元:纯函数(裁剪/投影)bun:test;local-asset 既有测试回归。
- typecheck:monorepo 全量。
- 真机:完整 build dev → 启动 → user 逐格式目测(视觉项无法自动判定对错,GUI 自动化又不宜在 user 工作
  环境跑)→ 据反馈迭代(颜色深浅 / 托盘大小)直到 user 确认。
