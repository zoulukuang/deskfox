---
feat-id: home-empty-onboarding-copy
status: done
related: ./3-changelog.md
---

# 3-changelog — home-empty-onboarding-copy

> Medium 规模(首页 home 品牌化改造:常驻引导 + wordmark + CTA + 布局/配色),按规范写 3-changelog.md。
> 需求起点:首页**引导欢迎文案常驻顶部**,对齐设计稿
> `OPENCODE-PLAN/首次引导/onboarding-final.html`。随 user 真机迭代,逐步扩展为一次完整的首页视觉定稿。
> 迭代过程用「独立 HTML 预览 + Edge 无头截图」做秒级调样,定稿后才搬回真应用(预览件留在 `D:\tmp\deskfox-preview\`,不入仓)。

## 最终定稿(user 逐项拍板)

| 项 | 定稿值 |
|---|---|
| Logo | DeskFoX.Ai 品牌 **wordmark SVG**(来源 `OPENCODE-PLAN/品牌设计/SVG/wordmark.svg`),宽 240px(`w-60`),**半透明 0.5**(`opacity-50`) |
| 标题 `home.welcome.title` | 「你的专属 AI 工作助理已就绪」,**加粗 700 + 中灰**(`--text-base` #6f6f6f,原近黑 #171717 太黑) |
| 副标题 `home.welcome.description` | 「将本地项目文件夹交给 Fox…」,**一行**(列宽够宽自然不换行) |
| CTA 按钮 `home.welcome.open` | 「**打开文件夹**」(原「打开项目文件夹」精简),**实心**,DeskFox **钢蓝 #7295C4**(取自 logo 狐狸脸主色),folder 图标,**常驻**(有无最近项目都显示) |
| 列宽 | **552px**(`md:w-[552px]`,含 px-4 后内容 ≈520px),桌面端固定、居中;窄屏 `w-full` |
| 最近项目 | 列表保留;**去掉**头部重复的「打开项目」小按钮(打开入口已上移为常驻 CTA),只留标题 + 列表 |

布局(常驻结构,有无最近项目都一致):
```
DeskFoX.Ai (wordmark, 半透明)
● 本地服务器
你的专属 AI 工作助理已就绪          (加粗中灰)
将本地项目文件夹交给 Fox…           (一行)
[ 📁 打开文件夹 ]                    (钢蓝实心 CTA,常驻)
── 有最近项目时 ──
最近项目
<列表>
```

## 关键决策与纠偏

- **从「空状态」→「常驻」**:初版误把引导文案放进 `<Switch>` 的空状态分支(零项目才显示)。真机验收后 user 澄清要**常驻顶部**,遂提到 Switch 外;`<Switch>`(3 分支)简化为单个 `<Show when={有最近项目}>`(只控列表)。i18n key `home.empty.*` → `home.welcome.*`。
- **宽度模型**:CDP 实测原 `md:w-auto` 是「收缩到最宽子元素」(实测 392px,被副标题 max-w 撑),非固定也非按分辨率。user 要更宽 → 改固定 `md:w-[552px]`。
- **配色取自真 logo**:user 否决高亮蓝 #034cff,改从 `wordmark.svg` 取钢蓝 #7295C4;CTA 实心 vs 描边两种样式预览对比后选实心。

## 落地改动

| 文件 | 改动 | 类型 |
|---|---|---|
| `packages/app/src/components/deskfox-wordmark.tsx` | **新增** fork-only 组件:DeskFoX.Ai wordmark SVG(内联,品牌固有 fill 色) | 新文件(P1) |
| `packages/app/src/pages/home.tsx` | 换 `<Logo>`→`<DeskFoxWordmark>`;欢迎横幅 + 钢蓝 CTA 提为常驻;`Switch/Match`→`Show`;列宽 `md:w-auto`→`md:w-[552px]`;去最近项目头部按钮;标题用 `deskfox-home-title`;CTA 用 `deskfox-cta` + `variant=primary`。整段 FORK marker | 改上游 |
| `packages/app/src/index.css` | **新增** fork CSS:`--deskfox-cta-base/hover` 钢蓝变量 + `[data-variant=primary].deskfox-cta` 覆盖按钮色(加一档特异性稳压上游变体)+ `.deskfox-home-title`(700/中灰)。FORK marker | fork 入口 CSS(R3 合规:品牌色走自有 CSS 变量,不动上游 button/text token) |
| `packages/app/src/i18n/{17 langs}.ts` | `home.welcome.{title,description,open}` 三值(title/desc 套设计稿、open 精简为「打开文件夹」);en/zh/zht 三主力带 FORK marker | i18n |

## 验证

- i18n 全套(completeness + rebrand)**15 pass / 0 fail** —— `home.welcome.*` 三键 17 语言齐全。
- app 包 typecheck `tsgo -b` **通过**(0 error)。
- release exe build + 真机最终验收(wordmark 渲染 / CTA 钢蓝 / 常驻引导 / 有最近项目时也显示) —— **待 user QA**(对照 [[feedback_cdp_selftest_complements_not_replaces_qa]],视觉/native 属真桌面范畴)。

## 规模 / 影响

- **Medium**:1 新组件 + home.tsx 重排 + index.css 品牌 CSS + 17 i18n;`home.tsx` / `index.css` 是上游/ fork 入口,均带 FORK marker。
- **回退**:`git revert` 本系列 commit;恢复后首页回上游「最近项目/空状态」原结构 + 原文案。
- **R3**:品牌色集中走 `index.css` 自有 CSS 变量(`--deskfox-cta-*`),wordmark 走独立 fork 组件,**不改上游 button 变体 / text token / Logo 组件**。**0 R4 override / 0 黑名单**。
