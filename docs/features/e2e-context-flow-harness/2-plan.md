feat-id: e2e-context-flow-harness
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实施计划 + 决策轨迹

## 决策(user 2026-09-19 拍板)

1. v2 无注释卡不渲染 → **本 feat 一起修**
2. 无注释卡可达性 → **顺手修**(结果:可达性本来就有,真问题是渲染侧判据,见 1-spec §三)
3. 工具范围 → **只做核心交互层**,后端故障面不做

## 顺序

1. 尖刺验可行性(选 Playwright 还是 CDP-python)→ 选 Playwright
2. 摸清 5 条部落知识(shadow 选区 / 真鼠标 / 两步浮层 / 两套 composer / 无测试契约)
3. 产品侧最小改动:判据同源 + `data-*` 测试契约
4. 工具:`utils/context-flows.ts`
5. 用例:`regression/context-card-flows.spec.ts`,逐条对应 R8 清单
6. 反证 + 全量回归

## 过程里推翻过的两个结论(留痕)

- **「v2 完全不渲染引用卡」→ 错**。只量了 legacy 容器 class;v2 有自己的卡片条。
  订正后真实缺陷是「只渲染有注释的卡」。
- **「浮层点按钮无效、只有 Enter 有效」→ 错**。2×2 交叉证明手势无关,差异在空注释。
  两次都是**同一个错误模式:一次实验里动了两个变量**。第三次起改为先做 2×2。

## 工具设计上的三个取舍

1. **不引入 `window.__deskfoxTestBridge`**:本来想暴露 store 快照做"身份断言",
   评估后否掉 —— `data-*` 已足够,且调试全局要按渠道 gate,是长期负担。
2. **拖选失败退三击**:拖选对 padding / 行内换行敏感;三击整段选中同样是真实用户动作、
   对布局不敏感。两者都走真鼠标事件(产品只认这一种)。
3. **布局差异吃在工具里**:`openFileInPreview` 内部分流 v2 / 经典两套文件树 DOM,
   spec 侧只管文件名。
